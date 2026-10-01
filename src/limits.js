/** Bounded in-process limiter. Direct peer addresses are trusted; forwarding headers are ignored. */
export function createRateLimiter({clock=Date.now,windowMs=60000,reads=240,writes=40,maxKeys=20000}={}){
  const buckets=new Map();
  return ({actor,request,mutation})=>{
    const now=clock(),keys=['peer:'+request.socket.remoteAddress,...(actor?.userId?['user:'+actor.userId]:[])].map(k=>k+':'+(mutation?'write':'read'));
    for(const [key,value]of buckets)if(value.reset<=now)buckets.delete(key);
    for(const key of keys){const old=buckets.get(key);if(!old){if(buckets.size>=maxKeys)return false;buckets.set(key,{count:0,reset:now+windowMs});}if(buckets.get(key).count>=(mutation?writes:reads))return false;}
    keys.forEach(key=>buckets.get(key).count++);return true;
  };
}
