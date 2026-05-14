# file-diff-desktop

Beyond Compare–style folder and file diff: pick two folders, browse differences, open files in a Monaco side-by-side diff editor (with gutter arrows to copy hunks), and **Save left** / **Save right** to write changes to disk.

## Run

Use **Node 24** (see [`.nvmrc`](./.nvmrc)) so `@tauri-apps/cli` installs the correct native binding for your machine. With [nvm](https://github.com/nvm-sh/nvm): `nvm use`.

```sh
npm install   # also vendors Monaco into src/vendor/monaco/ (gitignored)
npm run tauri dev
```

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
