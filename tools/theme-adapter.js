import {readFile} from 'node:fs/promises';
import {adaptDesignSystemRules} from '../core/design-system-adapter.js';
import {listDesignSystemReferences} from '../core/design-system-inventory.js';
// Report to stdout; never edits the input or upstream repository.
try{
 const path=process.argv[2];
 if(path==='--inventory')console.log(JSON.stringify(listDesignSystemReferences(),null,2));
 else if(!path)throw new Error('Usage: node tools/theme-adapter.js <reviewed-mapping.json> | --inventory');
 else console.log(JSON.stringify(await adaptDesignSystemRules(JSON.parse(await readFile(path,'utf8'))),null,2));
}catch(error){console.error(error.code?`${error.code}: ${error.message}`:error.message);process.exitCode=1;}
