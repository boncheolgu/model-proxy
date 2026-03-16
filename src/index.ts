import { createApp } from './app.js';

const port = Number(process.env.PORT || 8787);
const app = createApp();

app.listen(port, () => {
  process.stdout.write(`model-proxy listening on :${port}\n`);
});
