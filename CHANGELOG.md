# Changelog

[Compare changes](https://github.com/stacksjs/ts-audio/compare/v0.1.0...v-audio-0.1.1)

## 🚀 Features

- auto register audio formats ([2ff419e](https://github.com/stacksjs/ts-audio/commit/2ff419e)) _(by Chris <chrisbreuer93@gmail.com>)_
- export native audio transcoder ([b988f35](https://github.com/stacksjs/ts-audio/commit/b988f35)) _(by Chris <chrisbreuer93@gmail.com>)_
- add native audio transcoding ([9a60f4b](https://github.com/stacksjs/ts-audio/commit/9a60f4b)) _(by Chris <chrisbreuer93@gmail.com>)_
- add protected audio delivery workflow ([ad9e15e](https://github.com/stacksjs/ts-audio/commit/ad9e15e)) _(by Chris <chrisbreuer93@gmail.com>)_
- add native audio delivery planning ([f133f6f](https://github.com/stacksjs/ts-audio/commit/f133f6f)) _(by Chris <chrisbreuer93@gmail.com>)_

## 🐛 Bug Fixes

- **pkg**: publish audio core from org scope ([6c27261](https://github.com/stacksjs/ts-audio/commit/6c27261)) _(by Chris <chrisbreuer93@gmail.com>)_
- **ogg**: preserve packet lacing and duration ([58a4efd](https://github.com/stacksjs/ts-audio/commit/58a4efd)) _(by Chris <chrisbreuer93@gmail.com>)_
- **wav**: reject unsupported sample formats ([9511bcc](https://github.com/stacksjs/ts-audio/commit/9511bcc)) _(by Chris <chrisbreuer93@gmail.com>)_
- **ogg**: preserve multi-frame Opus timing ([d483a32](https://github.com/stacksjs/ts-audio/commit/d483a32)) _(by Chris <chrisbreuer93@gmail.com>)_
- emit native AAC delivery ([bde065a](https://github.com/stacksjs/ts-audio/commit/bde065a)) _(by Chris <chrisbreuer93@gmail.com>)_
- build audio subpath exports ([960d8a3](https://github.com/stacksjs/ts-audio/commit/960d8a3)) _(by Chris <chrisbreuer93@gmail.com>)_
- **scripts**: stop double-generating CHANGELOG on release ([9cb1c79](https://github.com/stacksjs/ts-audio/commit/9cb1c79)) _(by Glenn Michael Torregosa <gtorregosa@gmail.com>)_
- **docs**: strip trailing newlines ([55bc718](https://github.com/stacksjs/ts-audio/commit/55bc718)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- add setup-bun to publish-commit job ([a6420f3](https://github.com/stacksjs/ts-audio/commit/a6420f3)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- fix lint error and add basic tests ([89a0331](https://github.com/stacksjs/ts-audio/commit/89a0331)) _(by glennmichael123 <gtorregosa@gmail.com>)_

## 📚 Documentation

- update index ([73a30ec](https://github.com/stacksjs/ts-audio/commit/73a30ec)) _(by Chris <chrisbreuer93@gmail.com>)_

## 🧪 Tests

- add audio round-trip fixtures ([50e6bee](https://github.com/stacksjs/ts-audio/commit/50e6bee)) _(by Chris <chrisbreuer93@gmail.com>)_

## 🤖 Continuous Integration

- build audio packages before publish ([9f7b964](https://github.com/stacksjs/ts-audio/commit/9f7b964)) _(by Chris <chrisbreuer93@gmail.com>)_
- publish audio workspace with Pantry ([a316579](https://github.com/stacksjs/ts-audio/commit/a316579)) _(by Chris <chrisbreuer93@gmail.com>)_
- drop redundant setup-bun (pantry installs bun via deps.yaml) ([a808da6](https://github.com/stacksjs/ts-audio/commit/a808da6)) _(by glennmichael123 <gtorregosa@gmail.com>)_

## 🧹 Chores

- release v0.1.1 ([409f0fb](https://github.com/stacksjs/ts-audio/commit/409f0fb)) _(by Chris <chrisbreuer93@gmail.com>)_
- release v0.1.0 ([083f8b7](https://github.com/stacksjs/ts-audio/commit/083f8b7)) _(by Chris <chrisbreuer93@gmail.com>)_
- **deps**: declare bun ^1.3.14 in deps.yaml ([73ea019](https://github.com/stacksjs/ts-audio/commit/73ea019)) _(by Chris <chrisbreuer93@gmail.com>)_
- release v0.0.1 ([effc869](https://github.com/stacksjs/ts-audio/commit/effc869)) _(by Chris <chrisbreuer93@gmail.com>)_
- **pkg**: publint clean — sideEffects:false + executable bin shebang ([2244cd9](https://github.com/stacksjs/ts-audio/commit/2244cd9)) _(by Chris <chrisbreuer93@gmail.com>)_
- **deps**: refresh bun.lock to pick up pickier 0.1.37 ([426faed](https://github.com/stacksjs/ts-audio/commit/426faed)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- **deps**: refresh bun.lock to pick up pickier 0.1.35 ([19aaf3e](https://github.com/stacksjs/ts-audio/commit/19aaf3e)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- **deps**: refresh bun.lock to pick up pickier 0.1.33 ([4054d7a](https://github.com/stacksjs/ts-audio/commit/4054d7a)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- **deps**: refresh bun.lock to pick up @stacksjs/logsmith 0.2.3 ([6f84865](https://github.com/stacksjs/ts-audio/commit/6f84865)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- **deps**: refresh bun.lock to pick up buddy-bot 0.9.20 ([897c40c](https://github.com/stacksjs/ts-audio/commit/897c40c)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- **deps**: bump better-dx to ^0.2.15 ([dd696a1](https://github.com/stacksjs/ts-audio/commit/dd696a1)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- ignore pantry directory ([27589f3](https://github.com/stacksjs/ts-audio/commit/27589f3)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- **ci**: bump actions/checkout to v6, actions/cache to v5 ([3fd7aaa](https://github.com/stacksjs/ts-audio/commit/3fd7aaa)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- refresh bun.lock to pick up bun-plugin-dtsx@0.9.18 ([8de0313](https://github.com/stacksjs/ts-audio/commit/8de0313)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- refresh bun.lock and apply pickier --fix ([0b31d25](https://github.com/stacksjs/ts-audio/commit/0b31d25)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- refresh bun.lock ([59ce24c](https://github.com/stacksjs/ts-audio/commit/59ce24c)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- lint:fix ([d3c942d](https://github.com/stacksjs/ts-audio/commit/d3c942d)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- refresh bun.lock to pick up latest pickier ([2ff2e0c](https://github.com/stacksjs/ts-audio/commit/2ff2e0c)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- fresh install to pick up dtsx 0.9.14 and bunfig 0.15.9 ([15ed8d5](https://github.com/stacksjs/ts-audio/commit/15ed8d5)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- use --bun flag in release script ([94804a8](https://github.com/stacksjs/ts-audio/commit/94804a8)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- fresh install to pick up pickier 0.1.21 ([2c0aeb1](https://github.com/stacksjs/ts-audio/commit/2c0aeb1)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- update vscode config ([d3fc2d0](https://github.com/stacksjs/ts-audio/commit/d3fc2d0)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- update vscode config ([0762262](https://github.com/stacksjs/ts-audio/commit/0762262)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- update dependencies ([d79ea3c](https://github.com/stacksjs/ts-audio/commit/d79ea3c)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- remove redundant docs/.vitepress ([0530bf8](https://github.com/stacksjs/ts-audio/commit/0530bf8)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- remove .zed and .cursor folders ([c57ec7f](https://github.com/stacksjs/ts-audio/commit/c57ec7f)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- use Pantry action for publish-commit and add job dependencies ([4610a7f](https://github.com/stacksjs/ts-audio/commit/4610a7f)) _(by Chris <chrisbreuer93@gmail.com>)_
- fix better-dx version to ^0.2.7 ([4399924](https://github.com/stacksjs/ts-audio/commit/4399924)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- migrate to better-dx ([1fb64c3](https://github.com/stacksjs/ts-audio/commit/1fb64c3)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- remove .pickierignore ([b4889e7](https://github.com/stacksjs/ts-audio/commit/b4889e7)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- update better-dx to ^0.2.7 ([85b9740](https://github.com/stacksjs/ts-audio/commit/85b9740)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- enrich CLAUDE.md with detailed project context from README ([a84d7b2](https://github.com/stacksjs/ts-audio/commit/a84d7b2)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- update CLAUDE.md with project context and crosswind details ([440aa8e](https://github.com/stacksjs/ts-audio/commit/440aa8e)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- add proper claude code guidelines ([d2336bf](https://github.com/stacksjs/ts-audio/commit/d2336bf)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- ignore claude config in linter ([bb7165c](https://github.com/stacksjs/ts-audio/commit/bb7165c)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- add claude code guidelines ([41c6e98](https://github.com/stacksjs/ts-audio/commit/41c6e98)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- wip ([4ba7561](https://github.com/stacksjs/ts-audio/commit/4ba7561)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- wip ([4cae173](https://github.com/stacksjs/ts-audio/commit/4cae173)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- wip ([cbf8a8a](https://github.com/stacksjs/ts-audio/commit/cbf8a8a)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- wip ([cd40281](https://github.com/stacksjs/ts-audio/commit/cd40281)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- wip ([f8c7a09](https://github.com/stacksjs/ts-audio/commit/f8c7a09)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- wip ([0b6c40e](https://github.com/stacksjs/ts-audio/commit/0b6c40e)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- **deps**: update dependency actions/cache to v5.0.3 (#1529) ([b7f8d9b](https://github.com/stacksjs/ts-audio/commit/b7f8d9b)) _(by Chris <chrisbreuer93@gmail.com>)_ ([#1529](https://github.com/stacksjs/ts-audio/issues/1529), [#1529](https://github.com/stacksjs/ts-audio/issues/1529))
- **deps**: update dependency actions/checkout to v6.0.2 (#1530) ([dd70588](https://github.com/stacksjs/ts-audio/commit/dd70588)) _(by Chris <chrisbreuer93@gmail.com>)_ ([#1530](https://github.com/stacksjs/ts-audio/issues/1530), [#1530](https://github.com/stacksjs/ts-audio/issues/1530))
- **deps**: update all non-major dependencies (#1531) ([15c5b18](https://github.com/stacksjs/ts-audio/commit/15c5b18)) _(by Chris <chrisbreuer93@gmail.com>)_ ([#1531](https://github.com/stacksjs/ts-audio/issues/1531), [#1531](https://github.com/stacksjs/ts-audio/issues/1531))
- wip ([312fd82](https://github.com/stacksjs/ts-audio/commit/312fd82)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- wip ([a04e2b7](https://github.com/stacksjs/ts-audio/commit/a04e2b7)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- wip ([07d163f](https://github.com/stacksjs/ts-audio/commit/07d163f)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- wip ([546423f](https://github.com/stacksjs/ts-audio/commit/546423f)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- wip ([6c31b06](https://github.com/stacksjs/ts-audio/commit/6c31b06)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- wip ([ad996a6](https://github.com/stacksjs/ts-audio/commit/ad996a6)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- wip ([70a40ba](https://github.com/stacksjs/ts-audio/commit/70a40ba)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- wip ([fdb5f1e](https://github.com/stacksjs/ts-audio/commit/fdb5f1e)) _(by glennmichael123 <gtorregosa@gmail.com>)_
- add claude and improve og-image ([74c949b](https://github.com/stacksjs/ts-audio/commit/74c949b)) _(by cab-mikee <mike.cabz32@gmail.com>)_
- add better-dx ([a00bdf5](https://github.com/stacksjs/ts-audio/commit/a00bdf5)) _(by cab-mikee <mike.cabz32@gmail.com>)_
- adjust cli and clarity ([8457ea7](https://github.com/stacksjs/ts-audio/commit/8457ea7)) _(by cab-mikee <mike.cabz32@gmail.com>)_
- add clarity config ([0cb7cf6](https://github.com/stacksjs/ts-audio/commit/0cb7cf6)) _(by cab-mikee <mike.cabz32@gmail.com>)_
- enhance logger (#28) ([6b3d05e](https://github.com/stacksjs/ts-audio/commit/6b3d05e)) _(by Michael Vincent Caballero <mike.cabz32@gmail.com>)_ ([#28](https://github.com/stacksjs/ts-audio/issues/28), [#28](https://github.com/stacksjs/ts-audio/issues/28))
- change logger into stacksjs/clarity (#24) ([b8b9ca1](https://github.com/stacksjs/ts-audio/commit/b8b9ca1)) _(by Michael Vincent Caballero <mike.cabz32@gmail.com>)_ ([#24](https://github.com/stacksjs/ts-audio/issues/24), [#24](https://github.com/stacksjs/ts-audio/issues/24))
- **deps**: update dependency unocss to 66.5.1 (#25) ([a216dec](https://github.com/stacksjs/ts-audio/commit/a216dec)) _(by Chris <chrisbreuer93@gmail.com>)_ ([#25](https://github.com/stacksjs/ts-audio/issues/25), [#25](https://github.com/stacksjs/ts-audio/issues/25))
- **deps**: update all non-major dependencies (#27) ([e2809b6](https://github.com/stacksjs/ts-audio/commit/e2809b6)) _(by Chris <chrisbreuer93@gmail.com>)_ ([#27](https://github.com/stacksjs/ts-audio/issues/27), [#27](https://github.com/stacksjs/ts-audio/issues/27))
- **deps**: update all non-major dependencies (#26) ([0ff51a8](https://github.com/stacksjs/ts-audio/commit/0ff51a8)) _(by Chris <chrisbreuer93@gmail.com>)_ ([#26](https://github.com/stacksjs/ts-audio/issues/26), [#26](https://github.com/stacksjs/ts-audio/issues/26))
- **deps**: update all non-major dependencies (#23) ([5bdea21](https://github.com/stacksjs/ts-audio/commit/5bdea21)) _(by Chris <chrisbreuer93@gmail.com>)_ ([#23](https://github.com/stacksjs/ts-audio/issues/23), [#23](https://github.com/stacksjs/ts-audio/issues/23))
- **deps**: update dependency buddy-bot to ^0.9.7 (#21) ([3510acb](https://github.com/stacksjs/ts-audio/commit/3510acb)) _(by [renovate[bot] <29139614+renovate[bot]@users.noreply.github.com>](https://github.com/renovate[bot]))_ ([#21](https://github.com/stacksjs/ts-audio/issues/21), [#21](https://github.com/stacksjs/ts-audio/issues/21))
- **deps**: update dependency buddy-bot to 0.9.7 (#20) ([1a1bd9b](https://github.com/stacksjs/ts-audio/commit/1a1bd9b)) _(by Chris <chrisbreuer93@gmail.com>)_ ([#20](https://github.com/stacksjs/ts-audio/issues/20), [#20](https://github.com/stacksjs/ts-audio/issues/20))
- **deps**: update dependency @stacksjs/clapp to 0.2.0 (#19) ([7ae48a2](https://github.com/stacksjs/ts-audio/commit/7ae48a2)) _(by Chris <chrisbreuer93@gmail.com>)_ ([#19](https://github.com/stacksjs/ts-audio/issues/19), [#19](https://github.com/stacksjs/ts-audio/issues/19))
- **deps**: update dependency bunfig to 0.15.0 (#17) ([51374ff](https://github.com/stacksjs/ts-audio/commit/51374ff)) _(by Chris <chrisbreuer93@gmail.com>)_ ([#17](https://github.com/stacksjs/ts-audio/issues/17), [#17](https://github.com/stacksjs/ts-audio/issues/17))
- **deps**: update dependency actions/checkout to v5.0.0 (updated) (#16) ([1ab3a1b](https://github.com/stacksjs/ts-audio/commit/1ab3a1b)) _(by Chris <chrisbreuer93@gmail.com>)_ ([#16](https://github.com/stacksjs/ts-audio/issues/16), [#16](https://github.com/stacksjs/ts-audio/issues/16))
- **deps**: update dependency @stacksjs/eslint-config to 4.14.0-beta.3 (#15) ([9e95878](https://github.com/stacksjs/ts-audio/commit/9e95878)) _(by Chris <chrisbreuer93@gmail.com>)_ ([#15](https://github.com/stacksjs/ts-audio/issues/15), [#15](https://github.com/stacksjs/ts-audio/issues/15))
- **deps**: update all non-major dependencies (#13) ([3d1f9e8](https://github.com/stacksjs/ts-audio/commit/3d1f9e8)) _(by Chris <chrisbreuer93@gmail.com>)_ ([#13](https://github.com/stacksjs/ts-audio/issues/13), [#13](https://github.com/stacksjs/ts-audio/issues/13))
- **deps**: update actions/checkout action to v5 (#8) ([9406359](https://github.com/stacksjs/ts-audio/commit/9406359)) _(by [renovate[bot] <29139614+renovate[bot]@users.noreply.github.com>](https://github.com/renovate[bot]))_ ([#8](https://github.com/stacksjs/ts-audio/issues/8), [#8](https://github.com/stacksjs/ts-audio/issues/8))
- **deps**: update dependency unocss to v66 (#6) ([8881515](https://github.com/stacksjs/ts-audio/commit/8881515)) _(by [renovate[bot] <29139614+renovate[bot]@users.noreply.github.com>](https://github.com/renovate[bot]))_ ([#6](https://github.com/stacksjs/ts-audio/issues/6), [#6](https://github.com/stacksjs/ts-audio/issues/6))
- update tools ([e1c266f](https://github.com/stacksjs/ts-audio/commit/e1c266f)) _(by Adelino Ngomacha <adelinob335@gmail.com>)_
- update tools ([d8dd25b](https://github.com/stacksjs/ts-audio/commit/d8dd25b)) _(by Adelino Ngomacha <adelinob335@gmail.com>)_
- add features and advances ([02d02f6](https://github.com/stacksjs/ts-audio/commit/02d02f6)) _(by cab-mikee <mike.cabz32@gmail.com>)_
- add git-hooks with git-lint ([f20d47e](https://github.com/stacksjs/ts-audio/commit/f20d47e)) _(by cab-mikee <mike.cabz32@gmail.com>)_
- **deps**: update all non-major dependencies (#4) ([79b5da1](https://github.com/stacksjs/ts-audio/commit/79b5da1)) _(by [renovate[bot] <29139614+renovate[bot]@users.noreply.github.com>](https://github.com/renovate[bot]))_ ([#4](https://github.com/stacksjs/ts-audio/issues/4), [#4](https://github.com/stacksjs/ts-audio/issues/4))
- sponsors and stargazer improvement ([cad75f9](https://github.com/stacksjs/ts-audio/commit/cad75f9)) _(by cab-mikee <mike.cabz32@gmail.com>)_
- zip improvements ([9cdb572](https://github.com/stacksjs/ts-audio/commit/9cdb572)) _(by cab-mikee <mike.cabz32@gmail.com>)_
- add cursor rules ([d8c0cdc](https://github.com/stacksjs/ts-audio/commit/d8c0cdc)) _(by cab-mikee <mike.cabz32@gmail.com>)_
- improve package json ([b3b3dad](https://github.com/stacksjs/ts-audio/commit/b3b3dad)) _(by cab-mikee <mike.cabz32@gmail.com>)_
- improve postcardware ([ef79e3a](https://github.com/stacksjs/ts-audio/commit/ef79e3a)) _(by cab-mikee <mike.cabz32@gmail.com>)_
- **deps**: update all non-major dependencies (#3) ([97a01a6](https://github.com/stacksjs/ts-audio/commit/97a01a6)) _(by [renovate[bot] <29139614+renovate[bot]@users.noreply.github.com>](https://github.com/renovate[bot]))_ ([#3](https://github.com/stacksjs/ts-audio/issues/3), [#3](https://github.com/stacksjs/ts-audio/issues/3))
- enhance docs ([be88f75](https://github.com/stacksjs/ts-audio/commit/be88f75)) _(by cab-mikee <mike.cabz32@gmail.com>)_
- enhance test case ([9f8b763](https://github.com/stacksjs/ts-audio/commit/9f8b763)) _(by cab-mikee <mike.cabz32@gmail.com>)_
- enhance funding ([1219c77](https://github.com/stacksjs/ts-audio/commit/1219c77)) _(by cab-mikee <mike.cabz32@gmail.com>)_
- **deps**: update all non-major dependencies (#2) ([1e209c2](https://github.com/stacksjs/ts-audio/commit/1e209c2)) _(by [renovate[bot] <29139614+renovate[bot]@users.noreply.github.com>](https://github.com/renovate[bot]))_ ([#2](https://github.com/stacksjs/ts-audio/issues/2), [#2](https://github.com/stacksjs/ts-audio/issues/2))
- add github funding info ([3d22190](https://github.com/stacksjs/ts-audio/commit/3d22190)) _(by Chris <chrisbreuer93@gmail.com>)_
- add cli usage into readme ([258015c](https://github.com/stacksjs/ts-audio/commit/258015c)) _(by Chris <chrisbreuer93@gmail.com>)_
- release v0.1.1 ([7b7a8c3](https://github.com/stacksjs/ts-audio/commit/7b7a8c3)) _(by Chris <chrisbreuer93@gmail.com>)_
- rename package ([3a30bf0](https://github.com/stacksjs/ts-audio/commit/3a30bf0)) _(by Chris <chrisbreuer93@gmail.com>)_

## Contributors

- _Adelino Ngomacha <adelinob335@gmail.com>_
- _Chris <chrisbreuer93@gmail.com>_
- _Glenn Michael Torregosa <gtorregosa@gmail.com>_
- _Michael Vincent Caballero <mike.cabz32@gmail.com>_
- _[renovate[bot] <29139614+renovate[bot]@users.noreply.github.com>](https://github.com/renovate[bot])_
- _cab-mikee <mike.cabz32@gmail.com>_
- _glennmichael123 <gtorregosa@gmail.com>_

## v0.1.0...main

[compare changes](https://github.com/stacksjs/audiox/compare/v0.1.0...main)

### 🏡 Chore

- Rename package ([3a30bf0](https://github.com/stacksjs/audiox/commit/3a30bf0))

### ❤️ Contributors

- Chris ([@chrisbbreuer](http://github.com/chrisbbreuer))

## ...main

### 🏡 Chore

- Initial commit ([a5d1798](https://github.com/stacksjs/audiox/commit/a5d1798))

### ❤️ Contributors

- Chris ([@chrisbbreuer](http://github.com/chrisbbreuer))

## v0.9.0...main

[compare changes](https://github.com/stacksjs/rpx/compare/v0.9.0...main)

### 🏡 Chore

- Update bun version ([13d6955](https://github.com/stacksjs/rpx/commit/13d6955))
- Improve node support ([bba6f59](https://github.com/stacksjs/rpx/commit/bba6f59))
- Remove include option ([631c382](https://github.com/stacksjs/rpx/commit/631c382))
- Lint ([67d36c8](https://github.com/stacksjs/rpx/commit/67d36c8))

### ❤️ Contributors

- Chris ([@chrisbbreuer](http://github.com/chrisbbreuer))

## v0.8.1...main

[compare changes](https://github.com/stacksjs/rpx/compare/v0.8.1...main)

### 🩹 Fixes

- Properly utilize cleanup ([2128973](https://github.com/stacksjs/rpx/commit/2128973))

### 🏡 Chore

- Config changes ([51d56d2](https://github.com/stacksjs/rpx/commit/51d56d2))
- Minor adjustments ([5d81278](https://github.com/stacksjs/rpx/commit/5d81278))
- Update tlsx ([31581b8](https://github.com/stacksjs/rpx/commit/31581b8))

### ❤️ Contributors

- Chris ([@chrisbbreuer](http://github.com/chrisbbreuer))
- Cab-mikee ([@cab-mikee](http://github.com/cab-mikee))

## v0.8.0...main

[compare changes](https://github.com/stacksjs/rpx/compare/v0.8.0...main)

### 🏡 Chore

- Update eslint ([ac666c7](https://github.com/stacksjs/rpx/commit/ac666c7))
- Enhance docs ([05f937b](https://github.com/stacksjs/rpx/commit/05f937b))
- Enhance docs ([ce6ee4b](https://github.com/stacksjs/rpx/commit/ce6ee4b))
- Added iconify-json/carbon ([5fe085d](https://github.com/stacksjs/rpx/commit/5fe085d))
- Change unocss version ([c9d2481](https://github.com/stacksjs/rpx/commit/c9d2481))
- Enhance contributor content ([1a80f1f](https://github.com/stacksjs/rpx/commit/1a80f1f))
- Readme and lint  changes ([b91147d](https://github.com/stacksjs/rpx/commit/b91147d))
- Enhance config ([0892893](https://github.com/stacksjs/rpx/commit/0892893))
- Add bun lock text file ([f3a4fc9](https://github.com/stacksjs/rpx/commit/f3a4fc9))
- Build for node ([303473b](https://github.com/stacksjs/rpx/commit/303473b))
- Use only dev deps ([d1b7c9d](https://github.com/stacksjs/rpx/commit/d1b7c9d))
- Lint ([4b6b191](https://github.com/stacksjs/rpx/commit/4b6b191))

### ❤️ Contributors

- Chris ([@chrisbbreuer](http://github.com/chrisbbreuer))
- Cab-mikee ([@cab-mikee](http://github.com/cab-mikee))

## v0.7.1...main

[compare changes](https://github.com/stacksjs/rpx/compare/v0.7.1...main)

### 🚀 Enhancements

- Allow for cleaning up certificates ([a22b7d7](https://github.com/stacksjs/rpx/commit/a22b7d7))

### 🏡 Chore

- Update bun ([434a163](https://github.com/stacksjs/rpx/commit/434a163))

### ❤️ Contributors

- Chris ([@chrisbbreuer](http://github.com/chrisbbreuer))

## v0.7.0...main

[compare changes](https://github.com/stacksjs/rpx/compare/v0.7.0...main)

### 🩹 Fixes

- Properly pass vitePluginUsage ([f5b520b](https://github.com/stacksjs/rpx/commit/f5b520b))

### ❤️ Contributors

- Chris ([@chrisbbreuer](http://github.com/chrisbbreuer))

## v0.6.5...main

[compare changes](https://github.com/stacksjs/rpx/compare/v0.6.5...main)

### 🚀 Enhancements

- Allow for vite plugin usage ([64d7852](https://github.com/stacksjs/rpx/commit/64d7852))

### 🏡 Chore

- Docs updates ([5672ee8](https://github.com/stacksjs/rpx/commit/5672ee8))
- Docs updates ([79ce3c6](https://github.com/stacksjs/rpx/commit/79ce3c6))
- Add default docs theme ([eadc187](https://github.com/stacksjs/rpx/commit/eadc187))
- Wip ([a8566e0](https://github.com/stacksjs/rpx/commit/a8566e0))

### ❤️ Contributors

- Chris ([@chrisbbreuer](http://github.com/chrisbbreuer))

## v0.6.4...main

[compare changes](https://github.com/stacksjs/rpx/compare/v0.6.4...main)

### 🏡 Chore

- Update tlsx ([b5f1fc8](https://github.com/stacksjs/rpx/commit/b5f1fc8))

### ❤️ Contributors

- Chris ([@chrisbbreuer](http://github.com/chrisbbreuer))

## v0.6.3...main

[compare changes](https://github.com/stacksjs/rpx/compare/v0.6.3...main)

### 🏡 Chore

- Remove ununsed import ([3facd5f](https://github.com/stacksjs/rpx/commit/3facd5f))

### ❤️ Contributors

- Chris ([@chrisbbreuer](http://github.com/chrisbbreuer))

## v0.6.2...main

[compare changes](https://github.com/stacksjs/rpx/compare/v0.6.2...main)

### 🩹 Fixes

- Paths after splitting ([bb64b43](https://github.com/stacksjs/rpx/commit/bb64b43))

### ❤️ Contributors

- Chris ([@chrisbbreuer](http://github.com/chrisbbreuer))

## v0.6.1...main

[compare changes](https://github.com/stacksjs/rpx/compare/v0.6.1...main)

### 🏡 Chore

- Add splitting to build ([e74cdaf](https://github.com/stacksjs/rpx/commit/e74cdaf))

### ❤️ Contributors

- Chris ([@chrisbbreuer](http://github.com/chrisbbreuer))

## v0.6.0...main

[compare changes](https://github.com/stacksjs/rpx/compare/v0.6.0...main)

### 🏡 Chore

- Update readme examples ([4284e7e](https://github.com/stacksjs/rpx/commit/4284e7e))
- Minify build ([a00f9e6](https://github.com/stacksjs/rpx/commit/a00f9e6))
- Add bun options ([96bbef6](https://github.com/stacksjs/rpx/commit/96bbef6))

### ❤️ Contributors

- Chris ([@chrisbbreuer](http://github.com/chrisbbreuer))

## v0.5.1...main

[compare changes](https://github.com/stacksjs/rpx/compare/v0.5.1...main)

### 🚀 Enhancements

- Add cleanUrls option ([52ab5f8](https://github.com/stacksjs/rpx/commit/52ab5f8))

### 🏡 Chore

- Add eslint comments ([cd13a99](https://github.com/stacksjs/rpx/commit/cd13a99))

### ❤️ Contributors

- Chris ([@chrisbbreuer](http://github.com/chrisbbreuer))

## v0.5.0...main

[compare changes](https://github.com/stacksjs/rpx/compare/v0.5.0...main)

### 🏡 Chore

- Move some functionality to utils ([5d1effc](https://github.com/stacksjs/rpx/commit/5d1effc))
- Adjust sudo handling ([dd194be](https://github.com/stacksjs/rpx/commit/dd194be))

### ❤️ Contributors

- Chris ([@chrisbbreuer](http://github.com/chrisbbreuer))

## v0.4.1...main

[compare changes](https://github.com/stacksjs/rpx/compare/v0.4.1...main)

### 🏡 Chore

- Wip ([022f58e](https://github.com/stacksjs/rpx/commit/022f58e))
- Several improvements ([1e6266c](https://github.com/stacksjs/rpx/commit/1e6266c))

### ❤️ Contributors

- Chris ([@chrisbbreuer](http://github.com/chrisbbreuer))

## v0.4.0...main

[compare changes](https://github.com/stacksjs/rpx/compare/v0.4.0...main)

### 🏡 Chore

- Update readme ([08e61e8](https://github.com/stacksjs/rpx/commit/08e61e8))
- Ensure verbose is configurable ([0c2bb22](https://github.com/stacksjs/rpx/commit/0c2bb22))
- Add default export ([c064d8d](https://github.com/stacksjs/rpx/commit/c064d8d))
- Ensure verbose is false by default ([ee341b2](https://github.com/stacksjs/rpx/commit/ee341b2))

### ❤️ Contributors

- Chris ([@chrisbbreuer](http://github.com/chrisbbreuer))

## v0.3.1...main

[compare changes](https://github.com/stacksjs/rpx/compare/v0.3.1...main)

### 🚀 Enhancements

- Ensure multiple proxies work ([7420091](https://github.com/stacksjs/rpx/commit/7420091))

### 🩹 Fixes

- Ensure /etc/hosts is cleaned if configured ([501027c](https://github.com/stacksjs/rpx/commit/501027c))

### 🏡 Chore

- Several updates ([b519c5b](https://github.com/stacksjs/rpx/commit/b519c5b))
- Lint ([c47d212](https://github.com/stacksjs/rpx/commit/c47d212))

### ❤️ Contributors

- Chris ([@chrisbbreuer](http://github.com/chrisbbreuer))

## v0.3.0...main

[compare changes](https://github.com/stacksjs/rpx/compare/v0.3.0...main)

### 🏡 Chore

- Adjust readme ([8fd4f68](https://github.com/stacksjs/rpx/commit/8fd4f68))
- Some cleanup ([d8bf326](https://github.com/stacksjs/rpx/commit/d8bf326))

### ❤️ Contributors

- Chris ([@chrisbbreuer](http://github.com/chrisbbreuer))

## v0.2.0...main

[compare changes](https://github.com/stacksjs/rpx/compare/v0.2.0...main)

### 🚀 Enhancements

- /etc/hosts management ([53c930f](https://github.com/stacksjs/rpx/commit/53c930f))

### 🏡 Chore

- Update tlsx ([562613d](https://github.com/stacksjs/rpx/commit/562613d))
- Improve httpsConfig handling ([5d62350](https://github.com/stacksjs/rpx/commit/5d62350))

### ❤️ Contributors

- Chris ([@chrisbbreuer](http://github.com/chrisbbreuer))

## v0.1.1...main

[compare changes](https://github.com/stacksjs/rpx/compare/v0.1.1...main)

### 🚀 Enhancements

- Allow for `https` boolean ([6153960](https://github.com/stacksjs/rpx/commit/6153960))

### 🏡 Chore

- Export cleanup ([5565a04](https://github.com/stacksjs/rpx/commit/5565a04))
- Reset tests ([a758d40](https://github.com/stacksjs/rpx/commit/a758d40))
- Update readme ([10bdade](https://github.com/stacksjs/rpx/commit/10bdade))

### ❤️ Contributors

- Chris ([@chrisbbreuer](http://github.com/chrisbbreuer))

## v0.1.0...main (rpx)

[compare changes](https://github.com/stacksjs/rpx/compare/v0.1.0...main)

### 🚀 Enhancements

- Attach binaries ([a2453d1](https://github.com/stacksjs/rpx/commit/a2453d1))
- Auto generate ssl certs ([7f50167](https://github.com/stacksjs/rpx/commit/7f50167))

### 🏡 Chore

- Adjust lint:fix ([bfb06a4](https://github.com/stacksjs/rpx/commit/bfb06a4))
- Add stacks/biome-config ([553492b](https://github.com/stacksjs/rpx/commit/553492b))
- Add test to handle whether port 80 is in use ([b0c494c](https://github.com/stacksjs/rpx/commit/b0c494c))
- Adjust readme ([92e5fa2](https://github.com/stacksjs/rpx/commit/92e5fa2))
- Adjust cover ([d1fcac8](https://github.com/stacksjs/rpx/commit/d1fcac8))
- Adjust readme ([ecd9b5c](https://github.com/stacksjs/rpx/commit/ecd9b5c))
- Wip ([2ab3250](https://github.com/stacksjs/rpx/commit/2ab3250))
- Several improvements ([f33d379](https://github.com/stacksjs/rpx/commit/f33d379))
- Housekeeping ([1cdf696](https://github.com/stacksjs/rpx/commit/1cdf696))
- Core refactor ([8996c0c](https://github.com/stacksjs/rpx/commit/8996c0c))
- Get https to work ([4782f43](https://github.com/stacksjs/rpx/commit/4782f43))
- Resolve type errors ([4e30d5d](https://github.com/stacksjs/rpx/commit/4e30d5d))
- Lint ([1529f60](https://github.com/stacksjs/rpx/commit/1529f60))
- Adjust vscode settings ([c095ad1](https://github.com/stacksjs/rpx/commit/c095ad1))

### ❤️ Contributors

- Chris ([@chrisbbreuer](http://github.com/chrisbbreuer))

## v0.0.1...main

[compare changes](https://github.com/stacksjs/rpx/compare/v0.0.1...main)

### 🏡 Chore

- Wip ([c5e31d5](https://github.com/stacksjs/rpx/commit/c5e31d5))
- Wip ([6020df1](https://github.com/stacksjs/rpx/commit/6020df1))
- Wip ([be3dde1](https://github.com/stacksjs/rpx/commit/be3dde1))
- Wip ([e9e0feb](https://github.com/stacksjs/rpx/commit/e9e0feb))
- Wip ([383854c](https://github.com/stacksjs/rpx/commit/383854c))
- Wip ([363445b](https://github.com/stacksjs/rpx/commit/363445b))
- Add `rp` ([beced3c](https://github.com/stacksjs/rpx/commit/beced3c))
- Wip ([99cf0df](https://github.com/stacksjs/rpx/commit/99cf0df))
- Wip ([c9341a4](https://github.com/stacksjs/rpx/commit/c9341a4))
- Use `bun publish` ([6f6ae9d](https://github.com/stacksjs/rpx/commit/6f6ae9d))
- Add tests ([da19c51](https://github.com/stacksjs/rpx/commit/da19c51))
- Ignore docs cache ([81f2296](https://github.com/stacksjs/rpx/commit/81f2296))
- Use bunx ([ec65717](https://github.com/stacksjs/rpx/commit/ec65717))
- Adjust examples ([d4745fc](https://github.com/stacksjs/rpx/commit/d4745fc))
- Adjust build process ([1e5c63c](https://github.com/stacksjs/rpx/commit/1e5c63c))
- Remove postcompile ([52a9bc6](https://github.com/stacksjs/rpx/commit/52a9bc6))
- Remove lint:fix-unsafe ([91ad947](https://github.com/stacksjs/rpx/commit/91ad947))

### ❤️ Contributors

- Chris <chrisbreuer93@gmail.com>

## ...main (rpx)

### 🏡 Chore

- Initial commit ([beb4d96](https://github.com/stacksjs/rpx/commit/beb4d96))
- Wip ([8e3fce6](https://github.com/stacksjs/rpx/commit/8e3fce6))
- Wip ([bbb6783](https://github.com/stacksjs/rpx/commit/bbb6783))
- Wip ([2cfb363](https://github.com/stacksjs/rpx/commit/2cfb363))
- Wip ([6bb85ac](https://github.com/stacksjs/rpx/commit/6bb85ac))
- Wip ([602c9e1](https://github.com/stacksjs/rpx/commit/602c9e1))
- Wip ([5986105](https://github.com/stacksjs/rpx/commit/5986105))
- Wip ([c2bfec6](https://github.com/stacksjs/rpx/commit/c2bfec6))
- Wip ([454dd58](https://github.com/stacksjs/rpx/commit/454dd58))
- Wip ([b55ae41](https://github.com/stacksjs/rpx/commit/b55ae41))
- Wip ([e2f1350](https://github.com/stacksjs/rpx/commit/e2f1350))
- Wip ([61b2aa5](https://github.com/stacksjs/rpx/commit/61b2aa5))
- Wip ([a80283b](https://github.com/stacksjs/rpx/commit/a80283b))
- Wip ([97b9b16](https://github.com/stacksjs/rpx/commit/97b9b16))
- Wip ([fc8d633](https://github.com/stacksjs/rpx/commit/fc8d633))
- Wip ([e924f9c](https://github.com/stacksjs/rpx/commit/e924f9c))
- Wip ([249e8fa](https://github.com/stacksjs/rpx/commit/249e8fa))
- Wip ([1045bb1](https://github.com/stacksjs/rpx/commit/1045bb1))
- Wip ([c0a8bad](https://github.com/stacksjs/rpx/commit/c0a8bad))
- Wip ([f28b118](https://github.com/stacksjs/rpx/commit/f28b118))
- Wip ([712a5bf](https://github.com/stacksjs/rpx/commit/712a5bf))
- Wip ([2786e8d](https://github.com/stacksjs/rpx/commit/2786e8d))
- Wip ([1290366](https://github.com/stacksjs/rpx/commit/1290366))
- Wip ([030a8b7](https://github.com/stacksjs/rpx/commit/030a8b7))
- Wip ([2116f75](https://github.com/stacksjs/rpx/commit/2116f75))
- Wip ([5352f7a](https://github.com/stacksjs/rpx/commit/5352f7a))
- Wip ([1b99dd0](https://github.com/stacksjs/rpx/commit/1b99dd0))

### ❤️ Contributors

- Chris <chrisbreuer93@gmail.com>
