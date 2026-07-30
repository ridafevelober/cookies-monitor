const { checkForUpdates } = require('./index.js');
checkForUpdates().then(r => {
  console.log(JSON.stringify(r));
  process.exit(r.ok ? 0 : 1);
}).catch(e => {
  console.error(e.message);
  process.exit(1);
});