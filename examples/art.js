// Procedural demonstration drawings. Hosts supply their own licensed asset URLs.
export function demoArt(path){
  const name=path.match(/^\/demo\/art\/(dawn|cloud|aurora|solstice|fern|orchid|horizon|horizon-orbit)\.svg$/)?.[1];if(!name)return null;
  const wide=name.startsWith('horizon'),w=wide?1000:500,h=700;
  const palettes={dawn:['#e3bc83','#56696c','#17373e'],cloud:['#ccd9c9','#7b9e9e','#304e66'],aurora:['#183b49','#357e77','#0d2831'],solstice:['#dbb768','#a87761','#293c4b'],fern:['#69896d','#264b41','#092c31'],orchid:['#a88b93','#547367','#173b41'],horizon:['#e0bf81','#6c8c85','#1a4750']};
  const [top,middle,bottom]=palettes[name]??palettes.horizon;
  const defs=`<defs><linearGradient id="bg" x2="0" y2="1"><stop stop-color="${top}"/><stop offset=".55" stop-color="${middle}"/><stop offset="1" stop-color="${bottom}"/></linearGradient><linearGradient id="veil"><stop stop-color="#87e7bd" stop-opacity="0"/><stop offset=".5" stop-color="#87e7bd" stop-opacity=".6"/><stop offset="1" stop-color="#d7b4e7" stop-opacity="0"/></linearGradient><radialGradient id="sun"><stop stop-color="#fff3c8"/><stop offset="1" stop-color="#f1da99" stop-opacity=".2"/></radialGradient></defs>`;
  let scene=`<rect width="${w}" height="${h}" fill="url(#bg)"/>`;
  if(name==='horizon-orbit')scene='<path d="M270 220 Q500 70 730 220 Q500 400 270 220Z" fill="none" stroke="#fff3d1" stroke-opacity=".6" stroke-width="2"/><circle cx="500" cy="225" r="63" fill="#ffebba" fill-opacity=".32"/>';
  else if(['fern','orchid'].includes(name)){
    scene+=`<circle cx="250" cy="245" r="155" fill="none" stroke="#d5deb8" stroke-opacity=".25"/><circle cx="250" cy="245" r="130" fill="none" stroke="#d5deb8" stroke-opacity=".18"/><path d="M255 590 Q200 320 270 130" fill="none" stroke="#d2d6a1" stroke-width="3"/>`;
    for(let i=0;i<9;i++){const y=170+i*42,left=245-(i%3)*8,spread=55+i*5;scene+=`<path d="M${left} ${y+32} Q${left-spread} ${y+8} ${left-spread-10} ${y-24} Q${left-10} ${y-32} ${left} ${y+32}Z" fill="${i%2?'#a5bc82':'#7eaa7e'}" fill-opacity=".7"/><path d="M${left} ${y+36} Q${left+spread} ${y+10} ${left+spread+4} ${y-18} Q${left+2} ${y-27} ${left} ${y+36}Z" fill="#c0ca8a" fill-opacity=".45"/>`;}
    if(name==='orchid')for(let i=0;i<5;i++){const angle=i*72;scene+=`<ellipse cx="250" cy="205" rx="32" ry="70" fill="#e8c7ce" fill-opacity=".72" transform="rotate(${angle} 250 260)"/>`;}scene+='<circle cx="250" cy="260" r="24" fill="#ebd397"/>';
  }else{
    const sun=wide?500:name==='cloud'?320:250;
    scene+=`<circle cx="${sun}" cy="210" r="96" fill="url(#sun)"/><circle cx="${sun}" cy="210" r="115" fill="none" stroke="#f2e6c4" stroke-opacity=".4"/><circle cx="${sun}" cy="210" r="135" fill="none" stroke="#f2e6c4" stroke-opacity=".16"/>`;
    for(let i=0;i<55;i++){const x=(i*97+29)%w,y=(i*61+17)%400;scene+=`<circle cx="${x}" cy="${y}" r="${i%5===0?1.9:.8}" fill="#fff4d3" fill-opacity="${name==='aurora'?.7:.25}"/>`;}
    if(name==='aurora')scene+='<path d="M-100 80 Q300 160 180 300 T570 470" fill="none" stroke="url(#veil)" stroke-width="70"/><path d="M-120 120 Q310 200 240 340 T540 390" fill="none" stroke="url(#veil)" stroke-width="28"/>';
    const layers=[['#447274',350,150],['#2d555c',410,240],['#24464b',480,190],['#153c42',560,80]];for(const [color,y,bump]of layers)scene+=`<path d="M-20 ${y+40} Q${w*.18} ${y-bump} ${w*.38} ${y} T${w*.76} ${y-55} T${w+30} ${y+30} V700 H-20Z" fill="${color}" fill-opacity=".85"/>`;
    scene+=`<path d="M${w*.48} 430 Q${w*.55} 520 ${w*.43} 610 T${w*.52} 700" fill="none" stroke="#cbd3b0" stroke-opacity=".4" stroke-width="3"/>`;
    if(name==='solstice'){for(let i=0;i<18;i++){const a=i*Math.PI/9,x=sun+160*Math.cos(a),y=210+160*Math.sin(a);scene+=`<path d="M${x} ${y} L${sun+185*Math.cos(a)} ${210+185*Math.sin(a)}" stroke="#f4d58e" stroke-opacity=".7"/>`;}}
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${defs}${scene}</svg>`;
}
