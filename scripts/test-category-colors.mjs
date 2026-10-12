import assert from 'node:assert/strict';
import {build} from 'esbuild';
const result=await build({entryPoints:['family-calendar/ui/color-palette.ts'],bundle:true,platform:'node',format:'cjs',write:false});
const module={exports:{}};new Function('module','exports',result.outputFiles[0].text)(module,module.exports);
const {SOLID_COLORS,LEGACY_COLORS,CATEGORY_COLORS,colorText}=module.exports;
assert.equal(SOLID_COLORS.length,24);assert.equal(new Set(CATEGORY_COLORS).size,32);
for(const {color} of [...SOLID_COLORS,...LEGACY_COLORS]){
 const c=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255).map(v=>v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4));
 const luminance=c[0]*0.2126+c[1]*0.7152+c[2]*0.0722;
 const ratio=colorText(color)==='#ffffff'?1.05/(luminance+0.05):(luminance+0.05)/0.05;
 assert.ok(ratio>=4.5,color+' foreground must meet 4.5:1 contrast');
}
assert.equal(colorText('#facc15'),'#000000');assert.equal(colorText('#1f2937'),'#ffffff');
console.log('All 24 new and 8 existing colors have readable text (contrast >= 4.5:1).');
