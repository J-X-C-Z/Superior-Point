import {writeFile} from 'node:fs/promises';
import {fiveSlideDocument} from './five-slides.js';
import {exportHTML} from '../io/html.js';
const doc=fiveSlideDocument();
await writeFile(new URL('./five-slides.json',import.meta.url),JSON.stringify(doc,null,2));
await writeFile(new URL('./five-slides.html',import.meta.url),await exportHTML(doc));
