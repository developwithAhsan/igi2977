(function(){
  "use strict";
  var frame=document.getElementById("igi-siteb-frame");
  var loader=document.getElementById("igi-loader");
  var status=document.getElementById("igi-loader-status");
  var retryButton=document.getElementById("igi-retry");
  var comments=document.getElementById("disqus-frame");
  if(!frame||!loader)return;
  var ready=false,retries=0,maxRetries=3,timer=null;
  var workerOrigin="https://broken-salad-30b8.editingking-2977.workers.dev";
  function clearRetryTimer(){if(timer!==null){window.clearTimeout(timer);timer=null;}}
  function scheduleRetry(){
    clearRetryTimer();
    timer=window.setTimeout(function(){
      if(ready)return;
      if(retries<maxRetries){
        retries++;
        if(status)status.textContent="CONNECTING... RETRYING // ATTEMPT "+retries+" OF "+maxRetries;
        frame.src=workerOrigin+"/?r="+Date.now();
        scheduleRetry();
      }else if(status){
        status.textContent="CONNECTION DELAYED // KEEPING MISSION LINK ACTIVE";
      }
    },12000);
  }
  function retryNow(){
    if(ready)return;
    clearRetryTimer();
    if(retries<maxRetries){
      retries++;
      if(status)status.textContent="CONNECTING... RETRYING // ATTEMPT "+retries+" OF "+maxRetries;
      frame.src=workerOrigin+"/?r="+Date.now();
      scheduleRetry();
    }else if(status){
      status.textContent="MAX AUTO-RETRIES REACHED // PRESS RETRY TO TRY AGAIN";
    }
  }
  function markReady(height){
    if(ready)return;
    ready=true;clearRetryTimer();
    var viewport=Math.max(1,window.innerHeight||document.documentElement.clientHeight||1);
    var safeHeight=Math.max(viewport,Math.min(200000,Math.ceil(height)));
    frame.style.height=safeHeight+"px";
    frame.style.minHeight="100svh";
    document.body.classList.remove("igi-portal-loading");
    document.body.classList.add("igi-portal-loaded");
    if(loader)loader.setAttribute("aria-hidden","true");
  }
  window.addEventListener("message",function(event){
    if(event.origin!==workerOrigin||event.source!==frame.contentWindow||!event.data||event.data.type!=="igi-height")return;
    var height=Number(event.data.height);
    if(!Number.isFinite(height)||height<1)return;
    markReady(height);
  });
  frame.addEventListener("pointerdown",function(){frame.focus();});
  if(retryButton)retryButton.addEventListener("click",retryNow);
  /* Comments are requested only after the game iframe has begun its eager load. */
  if(comments&&comments.dataset.src){comments.src=comments.dataset.src;comments.removeAttribute("data-src");}
  scheduleRetry();
})();