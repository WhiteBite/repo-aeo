// A deliberately minimal library: it works, but nothing about it is discoverable.
function greet(name) {
  return `hello, ${name}`;
}

module.exports = { greet };

if (require.main === module) {
  console.log(greet('world'));
}
