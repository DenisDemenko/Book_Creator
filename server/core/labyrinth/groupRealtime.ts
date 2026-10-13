import type { WebSocket } from "ws";
/** The existing single-use book ticket identifies the user. Every notification rechecks
 * current account, book grant, group binding and edition revocation. Only a revision leaves here. */
export function subscribeGroupUpdates(ws:WebSocket,authorize:()=>Promise<number>,intervalMs=1500) {
  let closed=false,busy=false,last=-1;
  const poll=async()=>{
    if(closed||busy||ws.readyState!==1)return;busy=true;
    try{
      const revision=await authorize();
      if(!closed&&ws.readyState===1&&revision!==last){last=revision;ws.send(JSON.stringify({type:"labyrinth:changed",revision}));}
    }catch{if(!closed)ws.close(4403,"group_access_changed");}
    finally{busy=false;}
  };
  const timer=setInterval(()=>void poll(),intervalMs);timer.unref();
  const stop=()=>{closed=true;clearInterval(timer);};
  ws.once("close",stop);ws.once("error",stop);void poll();
  return stop;
}
