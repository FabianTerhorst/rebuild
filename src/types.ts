import { EventEmitter } from 'events';

export enum BuildType {
  Debug = 'Debug',
  Release = 'Release',
}

export type RebuildMode = 'sequential' | 'parallel';

export interface IRebuilder {
  ABI: string;
  arch: string;
  buildPath: string;
  buildType: BuildType;
  debug: boolean;
  disablePreGypCopy: boolean;
  nodeDir: string;
  nodeLibFile: string;
  nodeVersion: string;
  force: boolean;
  lifecycle: EventEmitter;
  mode: RebuildMode;
  msvsVersion?: string;
  platform: string;
}
