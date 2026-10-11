import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFile} from 'node:fs/promises';
import {initHomeMotion} from '../web/home-motion.js';

test('creation preview is inside the native button and does not interfere with its action', async () => {
 const dom = new JSDOM(await readFile(new URL('../web/index.html',import.meta.url),'utf8'));
 const doc=dom.window.document;
 initHomeMotion(doc);
 const button=doc.querySelector('#new-project'), field=button.querySelector('.home-dots');
 assert.equal(field.getAttribute('aria-hidden'),'true');
 assert.equal(field.children.length,40);
 assert.equal(doc.querySelector('.intro > .home-dots'),null);
 let clicks=0;button.addEventListener('click',()=>clicks++);
 field.firstChild.click();assert.equal(clicks,1);
 dom.window.close();
});
