import { createApp } from './app.js';

const port = Number(process.env.PORT || 8787);
const app = createApp();

app.listen(port, () => {
  process.stdout.write(`claude-openai-proxy listening on :${port}\n`);
});
