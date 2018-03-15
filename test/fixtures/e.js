const bPath = require.resolve('./b');
module.exports = {
  bPath,
  a: require('./a'),
  b: require(bPath)
}
