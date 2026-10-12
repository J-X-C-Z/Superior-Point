#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {inspectThemeDiagnostics} from '../core/theme-diagnostics.js';
const args=process.argv.slice(2);let path,kind,availableFonts;
try{
 for(let i=0;i<args.length;i++){if(args[i]==='--kind')kind=args[++i];else if(args[i]==='--fonts'){const value=args[++i];if(!value)throw Error();availableFonts=value.split(',').map(s=>s.trim()).filter(Boolean);}else if(args[i].startsWith('-')||path)throw Error();else path=args[i];}
 if(!path||kind!==undefined&&!['manifest','document'].includes(kind))throw Error();
 const raw=await readFile(path);if(raw.length>64*1024*1024)throw Error();
 const report=await inspectThemeDiagnostics(JSON.parse(raw.toString('utf8')),{kind,availableFonts});console.log(JSON.stringify(report));process.exitCode=report.valid?0:1;
}catch{console.log(JSON.stringify({valid:false,diagnostics:[{code:'INVALID_INPUT',status:'invalid',message:'Use: node tools/theme-validate.js <JSON file> [--kind manifest|document] [--fonts comma-separated names]. Input must be readable valid JSON within 64 MiB.'}]}));process.exitCode=1;}
