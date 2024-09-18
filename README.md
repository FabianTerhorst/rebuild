## CitizenFX Node Rebuild

[![NPM](https://img.shields.io/npm/v/@citizenfx/node-rebuild.svg?style=flat)](https://npm.im/@citizenfx/node-rebuild)

This package is based on [electron-rebuild](https://github.com/electron/rebuild).

This executable is rebuilding the native NodeJS modules 
you are using inside your FXServer resource
against the NodeJS version that is used by the FXServer.

### How does it work?

Install the @citizenfx/node-rebuild as a dev dependency with `--save-dev`:

```sh
npm install --save-dev @citizenfx/node-rebuild
```

Then, whenever you install a new package inside your FXServer resource, rerun node-rebuild:

```sh
$(npm bin)/node-rebuild
```

Or if you're on Windows:

```sh
.\node_modules\.bin\node-rebuild.cmd
```
The same works inside a script in your `package.json`:

```json
"scripts": {
  "rebuild": "node-rebuild -f"
}
```

and then

```sh
npm run rebuild
```

### What are the requirements?

Node v22.6.0 or higher is required. Building native modules from source uses
[`node-gyp`](https://github.com/nodejs/node-gyp#installation), refer to the link for its
installation/runtime requirements.

### What if the NodeJS version changed inside the FXServer?

The node-rebuild can be manually adjusted to rebuild against the NodeJS version that is required by providing the version as a cli argument.

```sh
node-rebuild --nodeVersion 22.6.0
```
