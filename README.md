<h1 align="center">
  <!-- Logo -->
  <br/>
  context-require
	<br/>

  <!-- Stability -->
  <a href="https://nodejs.org/api/documentation.html#documentation_stability_index">
    <img src="https://img.shields.io/badge/stability-stable-brightgreen.svg" alt="API Stability"/>
  </a>
  <!-- TypeScript -->
  <a href="http://typescriptlang.org">
    <img src="https://img.shields.io/badge/%3C%2F%3E-typescript-blue.svg" alt="TypeScript"/>
  </a>
  <!-- Prettier -->
  <a href="https://github.com/prettier/prettier">
    <img src="https://img.shields.io/badge/styled_with-prettier-ff69b4.svg" alt="Styled with prettier"/>
  </a>
  <!-- Travis build -->
  <a href="https://travis-ci.org/mlrawlings/context-require">
  <img src="https://img.shields.io/travis/mlrawlings/context-require.svg" alt="Build status"/>
  </a>
  <!-- Coveralls coverage -->
  <a href="https://coveralls.io/github/mlrawlings/context-require">
    <img src="https://img.shields.io/coveralls/mlrawlings/context-require.svg" alt="Test Coverage"/>
  </a>
  <!-- NPM version -->
  <a href="https://npmjs.org/package/context-require">
    <img src="https://img.shields.io/npm/v/context-require.svg" alt="NPM Version"/>
  </a>
  <!-- Downloads -->
  <a href="https://npmjs.org/package/context-require">
    <img src="https://img.shields.io/npm/dm/context-require.svg" alt="Downloads"/>
  </a>
</h1>

Creates a new require function which runs all required modules in a context other than `global`.
Supports custom `require extensions` and `resolvers`. Useful for things like mocking the `package.json`
browser field without a bundler and using JSDOM (without using jsdom global) along side the native
commonjs require system.

Although other uses are possible this module was built to run tests in a browser like context
with out using a bundler. Because modules are cached once per context this tool also makes it easy to
isolate globals and state between tests running in the same process.

# Installation

```console
npm install context-require
```

# Example

**./index.js**
```javascript
import createRequire from "context-require";

const browserRequire = createRequire({
  dir: __dirname,
  context: new JSDOM('<div>Hello World</div>').window, // This object becomes the context for any required files.
  extensions: ..., // Same as require.extensions but only used in the above context.
  resolve(from, request) {...} // Override file resolution for this context.
});

browserRequire("./get-document-body").innerHTML; // <div>Hello World</div>
```

**./get-document-body.js**
```js
typeof global; // undefined
module.exports = document.body;
```

### Contributions

* Use `npm test` to build and run tests.

Please feel free to create a PR!
