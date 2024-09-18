import debug from 'debug';
import { EventEmitter } from 'events';
import * as fs from 'fs-extra';
import * as path from 'path';

import { BuildType, IRebuilder, RebuildMode } from './types';
import { ModuleRebuilder } from './module-rebuilder';
import { ModuleType, ModuleWalker } from './module-walker';

import {fetch} from './fetcher';

import * as tar from 'tar';

export interface RebuildOptions {
  /**
   * The path to the `node_modules` directory to rebuild.
   */
  buildPath: string;

  nodeDir: string;
  nodeLibFile: string;
  nodeVersion: string;
  /**
   * Override the target rebuild architecture to something other than the host system architecture.
   * 
   * @defaultValue The system {@link https://nodejs.org/api/process.html#processarch | `process.arch`} value
   */
  arch?: string;
  /**
   * An array of module names to rebuild in addition to detected modules
   * @default []
   */
  extraModules?: string[];
  /**
   * An array of module names to rebuild. **Only** these modules will be rebuilt.
   */
  onlyModules?: string[] | null;
  /**
   * Force a rebuild of modules regardless of their current build state.
   */
  force?: boolean;
  /**
   * URL to download Electron header files from.
   * @defaultValue `https://www.electronjs.org/headers`
   */
  headerURL?: string;
  /**
   * Array of types of dependencies to rebuild. Possible values are `prod`, `dev`, and `optional`.
   * 
   * @defaultValue `['prod', 'optional']`
   */
  types?: ModuleType[];
  /**
   * Whether to rebuild modules sequentially or in parallel.
   * 
   * @defaultValue `sequential`
   */
  mode?: RebuildMode;
  /**
   * Rebuilds a Debug build of target modules. If this is `false`, a Release build will be generated instead.
   * 
   * @defaultValue false
   */
  debug?: boolean;
  /**
   * Path to the root of the project if using npm or yarn workspaces.
   */
  projectRootPath?: string;
  /**
   * Override the Application Binary Interface (ABI) version for the version of Electron you are targeting.
   * Only use when targeting nightly releases.
   * 
   * @see the {@link https://github.com/electron/node-abi | electron/node-abi} repository for a list of Electron and Node.js ABIs
   */
  forceABI?: number;
  /**
   * Disables the copying of `.node` files if not needed.
   * @defaultValue false
   */
  disablePreGypCopy?: boolean;
  /**
   * Array of module names to ignore during the rebuild process.
   */
  ignoreModules?: string[];
}

export interface RebuilderOptions extends RebuildOptions {
  lifecycle: EventEmitter;
}

const d = debug('node-rebuild');

const defaultMode: RebuildMode = 'sequential';
const defaultTypes: ModuleType[] = ['prod', 'optional'];

export class Rebuilder implements IRebuilder {
  private ABIVersion: string | undefined;
  private moduleWalker: ModuleWalker;
  rebuilds: (() => Promise<void>)[];

  public lifecycle: EventEmitter;
  public buildPath: string;
  public platform: string = process.platform;
  public arch: string;
  public force: boolean;
  public mode: RebuildMode;
  public debug: boolean;
  public msvsVersion?: string;
  public disablePreGypCopy: boolean;
  public ignoreModules: string[];
  public nodeDir: string;
  public nodeLibFile: string;
  public nodeVersion: string;

  constructor(options: RebuilderOptions) {
    this.lifecycle = options.lifecycle;
    this.buildPath = options.buildPath;
    this.nodeDir = options.nodeDir;
    this.nodeLibFile = options.nodeLibFile;
    this.nodeVersion = options.nodeVersion;
    this.arch = options.arch || process.arch;
    this.force = options.force || false;
    this.mode = options.mode || defaultMode;
    this.debug = options.debug || false;
    this.msvsVersion = process.env.GYP_MSVS_VERSION;
    this.disablePreGypCopy = options.disablePreGypCopy || false;
    this.ignoreModules = options.ignoreModules || [];
    d('ignoreModules', this.ignoreModules);

    this.ABIVersion = options.forceABI?.toString();
    const onlyModules = options.onlyModules || null;
    const extraModules = (options.extraModules || []).reduce((acc: Set<string>, x: string) => acc.add(x), new Set<string>());
    const types = options.types || defaultTypes;
    this.moduleWalker = new ModuleWalker(
      this.buildPath,
      options.projectRootPath,
      types,
      extraModules,
      onlyModules,
    );
    this.rebuilds = [];

    d(
      'rebuilding with args:',
      this.buildPath,
      this.arch,
      extraModules,
      this.force,
      types,
      this.debug
    );
  }

  get ABI(): string {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return this.ABIVersion!;
  }

  get buildType(): BuildType {
    return this.debug ? BuildType.Debug : BuildType.Release;
  }

  async rebuild(): Promise<void> {
    if (!await this.downloadNodeLibrary(this.nodeVersion)) {
        throw new Error('Could not download node library');
    }

    if (!await this.downloadNodeHeaders(this.nodeVersion)) {
        throw new Error('Could not download node headers');
    }

    if (!path.isAbsolute(this.buildPath)) {
      throw new Error('Expected buildPath to be an absolute path');
    }

    this.lifecycle.emit('start');

    await this.moduleWalker.walkModules();

    for (const nodeModulesPath of await this.moduleWalker.nodeModulesPaths) {
      await this.moduleWalker.findAllModulesIn(nodeModulesPath);
    }

    for (const modulePath of this.moduleWalker.modulesToRebuild) {
      this.rebuilds.push(() => this.rebuildModuleAt(modulePath));
    }

    this.rebuilds.push(() => this.rebuildModuleAt(this.buildPath));

    if (this.mode !== 'sequential') {
      await Promise.all(this.rebuilds.map(fn => fn()));
    } else {
      for (const rebuildFn of this.rebuilds) {
        await rebuildFn();
      }
    }
  }

  async downloadNodeLibrary(nodeVersion: string): Promise<boolean> {
    console.log(this.buildPath, nodeVersion);
    // split node version and find major version
    const nodeVersionSplit = nodeVersion.split('.');
    const nodeMajorVersion = nodeVersionSplit[0];
    if (!await fs.pathExists(this.buildPath + '/libnode-v' + nodeVersion + '/libnode' + nodeMajorVersion + '.lib')) {
      const res = await fetch('https://content.cfx.re/mirrors/vendor/node/v' + nodeVersion + '/libnode/libnode' + nodeMajorVersion + '.lib', 'buffer');
      console.log(res, typeof (res));
      if (!await fs.pathExists(this.buildPath + '/libnode-v' + nodeVersion)) {
        await fs.mkdir(this.buildPath + '/libnode-v' + nodeVersion);
      }
      await fs.writeFile(this.buildPath + '/libnode-v' + nodeVersion + '/libnode' + nodeMajorVersion + '.lib', res);
    }

    this.nodeLibFile = this.buildPath + '/libnode-v' + nodeVersion + '/libnode' + nodeMajorVersion + '.lib';
    return true;
  }
  
  async downloadNodeHeaders(nodeVersion: string): Promise<boolean> {
    console.log(this.buildPath, nodeVersion);

    if (!await fs.pathExists(this.buildPath + '/libnode-v' + nodeVersion + '/node-v' + nodeVersion)) {
      const res = await fetch('https://nodejs.org/download/release/v' + nodeVersion + '/node-v' + nodeVersion + '-headers.tar.gz', 'buffer');
      console.log(res, typeof (res));
      if (!await fs.pathExists(this.buildPath + '/libnode-v' + nodeVersion)) {
        await fs.mkdir(this.buildPath + '/libnode-v' + nodeVersion);
      }

      await fs.writeFile(this.buildPath + '/libnode-v' + nodeVersion + '/node-v' + nodeVersion + '-headers.tar.gz', res);

      await tar.extract({
        file: this.buildPath + '/libnode-v' + nodeVersion + '/node-v' + nodeVersion + '-headers.tar.gz',
        cwd: this.buildPath + '/libnode-v' + nodeVersion
      })

      await fs.remove(this.buildPath + '/libnode-v' + nodeVersion + '/node-v' + nodeVersion + '-headers.tar.gz');
    }

    this.nodeDir = this.buildPath + '/libnode-v' + nodeVersion + '/node-v' + nodeVersion;
    return true;
  }

  async rebuildModuleAt(modulePath: string): Promise<void> {
    if (!(await fs.pathExists(path.resolve(modulePath, 'binding.gyp')))) {
      return;
    }

    const moduleRebuilder = new ModuleRebuilder(this, modulePath);

    let moduleName = path.basename(modulePath);
    const parentName = path.basename(path.dirname(modulePath));
    if (parentName !== 'node_modules') {
      moduleName = `${parentName}/${moduleName}`;
    }

    this.lifecycle.emit('module-found', moduleName);

    if (!this.force && await moduleRebuilder.alreadyBuiltByRebuild()) {
      d(`skipping: ${moduleName} as it is already built`);
      this.lifecycle.emit('module-done', moduleName);
      this.lifecycle.emit('module-skip', moduleName);
      return;
    }

    d('checking', moduleName, 'against', this.ignoreModules);
    if (this.ignoreModules.includes(moduleName)) {
      d(`skipping: ${moduleName} as it is in the ignoreModules array`);
      this.lifecycle.emit('module-done', moduleName);
      this.lifecycle.emit('module-skip', moduleName);
      return;
    }
    
    if (await moduleRebuilder.rebuild()) {
      this.lifecycle.emit('module-done', moduleName);
    }
  }
}

export type RebuildResult = Promise<void> & { lifecycle: EventEmitter };

export function rebuild(options: RebuildOptions): RebuildResult {
  // eslint-disable-next-line prefer-rest-params
  d('rebuilding with args:', arguments);
  const lifecycle = new EventEmitter();
  const rebuilderOptions: RebuilderOptions = { ...options, lifecycle };
  const rebuilder = new Rebuilder(rebuilderOptions);

  const ret = rebuilder.rebuild() as RebuildResult;
  ret.lifecycle = lifecycle;

  return ret;
}
