const colors=new Set(['transparent','black','white','red','green','blue','gray','grey','yellow','orange','purple','pink','brown','navy','teal']);
const dimensions={padding:100,radius:100,borderWidth:12};
const legacyNames={'background':'background','background-color':'background','color':'color','border-color':'borderColor','padding':'padding','border-radius':'radius','border-width':'borderWidth'};
function color(value){
  if(typeof value!=='string'||value.length>80)return undefined;
  const text=value.trim().toLowerCase();
  if(colors.has(text)||/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(text))return text;
  const match=/^(rgb|rgba)\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})(?:\s*,\s*(0(?:\.[0-9]{1,3})?|1(?:\.0{1,3})?))?\s*\)$/.exec(text);
  if(!match||[match[2],match[3],match[4]].some(n=>Number(n)>255)||(match[1]==='rgba')!==Boolean(match[5]))return undefined;
  return text;
}
function clean(input){
  const output={};if(!input||typeof input!=='object'||Array.isArray(input))return output;
  for(const key of ['background','color','borderColor']){const value=color(input[key]);if(value!==undefined)output[key]=value;}
  for(const [key,max]of Object.entries(dimensions)){const value=input[key];if(typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=max)output[key]=value;}
  return output;
}
/** Read historical appearance without interpreting arbitrary CSS as a stylesheet. */
export function albumAppearance(layout={}){
  const legacy={};if(!layout||typeof layout!=='object'||Array.isArray(layout))return {};
  if(typeof layout.css==='string'&&layout.css.length<=10000){
    const source=layout.css.replace(/\/\*[\s\S]*?\*\//g,'');
    for(const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)){
      if(match[1].trim()!=='.dc-album')continue;
      for(const declaration of match[2].split(';')){
        const split=declaration.indexOf(':');if(split<0)continue;
        const key=legacyNames[declaration.slice(0,split).trim().toLowerCase()];if(!key)continue;
        let value=declaration.slice(split+1).trim();
        if(Object.hasOwn(dimensions,key)){if(!/^(?:[0-9]+(?:\.[0-9]+)?)(?:px)?$/.test(value))continue;value=Number(value.replace(/px$/,''));}
        legacy[key]=value;
      }
    }
  }
  return {...clean(legacy),...clean(layout.appearance)};
}
export function validateAlbumAppearance(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Album appearance must be an object');
  const result=clean(input);
  for(const key of Object.keys(input)){
    if(!['background','color','borderColor',...Object.keys(dimensions)].includes(key))throw new Error('Unknown album appearance field: '+key);
    if(!Object.hasOwn(result,key))throw new Error('Invalid album appearance value: '+key);
  }
  return result;
}
export function applyAlbumAppearance(node,appearance){
  const properties={background:'background-color',color:'color',borderColor:'border-color',padding:'padding',radius:'border-radius',borderWidth:'border-width'};
  for(const [name,value]of Object.entries(clean(appearance)))node.style.setProperty(properties[name],Object.hasOwn(dimensions,name)?value+'px':value);
  if(clean(appearance).borderWidth>0)node.style.setProperty('border-style','solid');
}
