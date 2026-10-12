export const SOLID_COLORS = [
  {name:'빨강',color:'#ef4444'}, {name:'주황',color:'#f97316'},
  {name:'호박',color:'#f59e0b'}, {name:'노랑',color:'#facc15'},
  {name:'라임',color:'#84cc16'}, {name:'초록',color:'#22c55e'},
  {name:'에메랄드',color:'#10b981'}, {name:'청록',color:'#14b8a6'},
  {name:'시안',color:'#06b6d4'}, {name:'하늘',color:'#0ea5e9'},
  {name:'파랑',color:'#3b82f6'}, {name:'인디고',color:'#6366f1'},
  {name:'바이올렛',color:'#8b5cf6'}, {name:'보라',color:'#a855f7'},
  {name:'마젠타',color:'#d946ef'}, {name:'분홍',color:'#ec4899'},
  {name:'장미',color:'#f43f5e'}, {name:'진빨강',color:'#b91c1c'},
  {name:'진주황',color:'#c2410c'}, {name:'진초록',color:'#15803d'},
  {name:'남색',color:'#1d4ed8'}, {name:'진보라',color:'#6d28d9'},
  {name:'회색',color:'#64748b'}, {name:'먹색',color:'#1f2937'},
] as const;
export const LEGACY_COLORS = [
  {name:'기존 인디고',color:'#4555ce'}, {name:'기존 보라',color:'#8260be'},
  {name:'기존 초록',color:'#257763'}, {name:'기존 갈색',color:'#bb5b3e'},
  {name:'기존 황토',color:'#b37419'}, {name:'기존 분홍',color:'#be517d'},
  {name:'기존 파랑',color:'#327fba'}, {name:'기존 회색',color:'#737b8c'},
] as const;
export const CATEGORY_COLORS = [...SOLID_COLORS,...LEGACY_COLORS].map(c=>c.color);
// Pick the higher-contrast foreground for opaque sRGB colors (at least 4.5:1).
export function colorText(color:string): '#000000'|'#ffffff' {
  if(!/^#[0-9a-f]{6}$/i.test(color))return '#000000';
  const channels=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255)
    .map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);
  const luminance=0.2126*channels[0]+0.7152*channels[1]+0.0722*channels[2];
  return luminance>0.179128784747792?'#000000':'#ffffff';
}
