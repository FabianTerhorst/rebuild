import debug from 'debug';
import detectLibc from 'detect-libc';
import path from 'path';

import { ELECTRON_GYP_DIR } from '../../constants';
import { NativeModule } from '..';
import { fork } from 'child_process';

const d = debug('node-rebuild');

export class NodeGyp extends NativeModule {
  async buildArgs(): Promise<string[]> {
    const args = [
      'node',
      'node-gyp',
      'rebuild',
      `--node_lib_file=${this.rebuilder.nodeLibFile}`,
      `--nodedir=${this.rebuilder.nodeDir}`,
    ];

    //args.push(d.enabled ? '--verbose' : '--silent');
    args.push('--verbose');

    if (this.rebuilder.debug) {
      args.push('--debug');
    }

    args.push(...(await this.buildArgsFromBinaryField()));

    return args;
  }

  async buildArgsFromBinaryField(): Promise<string[]> {
    const binary = await this.packageJSONFieldWithDefault('binary', {}) as Record<string, string>;
    let napiBuildVersion: number | undefined = undefined
    if (Array.isArray(binary.napi_versions)) {
      napiBuildVersion = Math.max(...binary.napi_versions.map(str => Number(str)));
    }
    const flags = await Promise.all(Object.entries(binary).map(async ([binaryKey, binaryValue]) => {
      if (binaryKey === 'napi_versions') {
        return;
      }

      let value = binaryValue

      if (binaryKey === 'module_path') {
        value = path.resolve(this.modulePath, value);
      }

      value = value.replace('{configuration}', this.rebuilder.buildType)
        .replace('{platform}', this.rebuilder.platform)
        .replace('{arch}', this.rebuilder.arch)
        .replace('{version}', await this.packageJSONField('version') as string)
        .replace('{libc}', await detectLibc.family() || 'unknown');
      if (napiBuildVersion !== undefined) {
        value = value.replace('{napi_build_version}', napiBuildVersion.toString())
      }
      for (const [replaceKey, replaceValue] of Object.entries(binary)) {
        value = value.replace(`{${replaceKey}}`, replaceValue);
      }

      return `--${binaryKey}=${value}`;
    }))

    return flags.filter(value => value) as string[];
  }

  async rebuildModule(): Promise<void> {
    if (this.modulePath.includes(' ')) {
      console.error('Attempting to build a module with a space in the path');
      console.error('See https://github.com/nodejs/node-gyp/issues/65#issuecomment-368820565 for reasons why this may not work');
      // FIXME: Re-enable the throw when more research has been done
      // throw new Error(`node-gyp does not support building modules with spaces in their path, tried to build: ${modulePath}`);
    }

    const env = {
      ...process.env,
    };
    const nodeGypArgs = await this.buildArgs();
    d('rebuilding', this.moduleName, 'with args', nodeGypArgs);

    const forkedChild = fork(path.resolve(__dirname, 'worker.js'), {
      env,
      cwd: this.modulePath,
      stdio: 'pipe',
    });
    const outputBuffers: Buffer[] = [];
    forkedChild.stdout?.on('data', (chunk) => {
      outputBuffers.push(chunk);
    });
    forkedChild.stderr?.on('data', (chunk) => {
      outputBuffers.push(chunk);
    });
    forkedChild.send({
      moduleName: this.moduleName,
      nodeGypArgs,
      devDir: this.rebuilder.mode === 'sequential' ? ELECTRON_GYP_DIR : path.resolve(ELECTRON_GYP_DIR, '_p', this.moduleName),
    });

    await new Promise<void>((resolve, reject) => {
      forkedChild.on('exit', (code) => {
        if (code === 0) return resolve();
        console.error(Buffer.concat(outputBuffers).toString());
        reject(new Error(`node-gyp failed to rebuild '${this.modulePath}'`))
      });
    });
  }
}
