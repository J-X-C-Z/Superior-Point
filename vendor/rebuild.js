// Rebuild the browser/Node string module from the checked-in official dist files.
import {readFile,writeFile} from 'node:fs/promises';
const js=(await readFile(new URL('./reveal.js',import.meta.url),'utf8')).replace(/\/\/# sourceMappingURL=.*$/m,'');
const css=await readFile(new URL('./reveal.css',import.meta.url),'utf8');
await writeFile(new URL('./reveal-bundle.js',import.meta.url),`// Official reveal.js 5.2.1, MIT; see REVEAL-LICENSE.\nexport const revealJS=${JSON.stringify(js)};\nexport const revealCSS=${JSON.stringify(css)};\n`);
