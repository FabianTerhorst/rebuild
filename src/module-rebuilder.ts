import debug from 'debug';
import * as fs from 'fs-extra';
import * as path from 'path';

import { NodeGyp } from './module-type/node-gyp/node-gyp';
import { IRebuilder } from './types';

const d = debug('node-rebuild');

export class ModuleRebuilder {
  private modulePath: string;
  private nodeGyp: NodeGyp;
  private rebuilder: IRebuilder;

  constructor(rebuilder: IRebuilder, modulePath: string) {
    this.modulePath = modulePath;
    this.rebuilder = rebuilder;

    this.nodeGyp = new NodeGyp(rebuilder, modulePath);
  }

  get metaPath(): string {
    return path.resolve(this.modulePath, 'build', this.rebuilder.buildType, '.forge-meta');
  }

  get metaData(): string {
    return `${this.rebuilder.arch}--${this.rebuilder.ABI}`;
  }

  async alreadyBuiltByRebuild(): Promise<boolean> {
    if (await fs.pathExists(this.metaPath)) {
      const meta = await fs.readFile(this.metaPath, 'utf8');
      return meta === this.metaData;
    }

    return false;
  }

  async rebuildNodeGypModule(): Promise<boolean> {
    await this.nodeGyp.rebuildModule();
    d('built via node-gyp:', this.nodeGyp.moduleName);
    await this.writeMetadata();
    await this.replaceExistingNativeModule();
    return true;
  }

  async replaceExistingNativeModule(): Promise<void> {
    const buildLocation = path.resolve(this.modulePath, 'build', this.rebuilder.buildType);

    d('searching for .node file', buildLocation);
    const buildLocationFiles = await fs.readdir(buildLocation);
    d('testing files', buildLocationFiles);

    const nodeFile = buildLocationFiles.find((file) => file !== '.node' && file.endsWith('.node'));
    const nodePath = nodeFile ? path.resolve(buildLocation, nodeFile) : undefined;

    if (nodePath && await fs.pathExists(nodePath)) {
      d('found .node file', nodePath);
      if (!this.rebuilder.disablePreGypCopy) {
        const abiPath = path.resolve(this.modulePath, `bin/${this.rebuilder.platform}-${this.rebuilder.arch}-${this.rebuilder.ABI}`);
        d('copying to prebuilt place:', abiPath);
        await fs.mkdir(abiPath, { recursive: true });
        await fs.copyFile(nodePath, path.join(abiPath, `${this.nodeGyp.moduleName}.node`));
      }
    }
  }

  async writeMetadata(): Promise<void> {
    await fs.outputFile(this.metaPath, this.metaData);
  }

  async rebuild(): Promise<boolean> {
    return await this.rebuildNodeGypModule();
  }
}
