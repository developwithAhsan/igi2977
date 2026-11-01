(function(){
  "use strict";
  var frame=document.getElementById("igi-siteb-frame");
  var loader=document.getElementById("igi-loader");
  var status=document.getElementById("igi-loader-status");
  var retryButton=document.getElementById("igi-retry");
  var wrapper=document.querySelector(".igi-game-shell");
  var fullscreenButton=document.getElementById("igi-fullscreen");
  var comments=document.getElementById("disqus-frame");
  if(!frame||!loader)return;
  var ready=false,retries=0,maxRetries=3,timer=null,idleTimer=null;
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
    if(retries>=maxRetries)retries=0;
    if(retries<maxRetries){
      retries++;
      if(status)status.textContent="CONNECTING... RETRYING // ATTEMPT "+retries+" OF "+maxRetries;
      frame.src=workerOrigin+"/?r="+Date.now();
      scheduleRetry();
    }else if(status){
      status.textContent="MAX AUTO-RETRIES REACHED // PRESS RETRY TO TRY AGAIN";
    }
  }
  function markReady(){
    if(ready)return;
    ready=true;clearRetryTimer();
    document.body.classList.remove("igi-portal-loading");
    document.body.classList.add("igi-portal-loaded");
    if(loader)loader.setAttribute("aria-hidden","true");
  }
  window.addEventListener("message",function(event){
    if(event.origin!==workerOrigin||event.source!==frame.contentWindow||!event.data||event.data.type!=="igi-height")return;
    markReady();
  });
  function resetControlsIdle(){
    if(!wrapper||!fullscreenButton)return;
    wrapper.classList.remove("igi-controls-idle");
    if(idleTimer!==null)window.clearTimeout(idleTimer);
    idleTimer=window.setTimeout(function(){wrapper.classList.add("igi-controls-idle");},3000);
  }
  function enterFullscreen(){
    if(!wrapper||!fullscreenButton)return;
    var request=wrapper.requestFullscreen||frame.requestFullscreen;
    if(typeof request!=="function")return;
    try{
      var result=request.call(wrapper.requestFullscreen?wrapper:frame);
      if(result&&typeof result.catch==="function")result.catch(function(){});
    }catch(error){}
  }
  if(wrapper){
    wrapper.addEventListener("pointerdown",function(event){
      if(event.target!==fullscreenButton&&event.target!==retryButton)frame.focus();
    });
    wrapper.addEventListener("mousemove",resetControlsIdle);
    wrapper.addEventListener("focusin",resetControlsIdle);
  }
  if(fullscreenButton){
    if(!wrapper||!(wrapper.requestFullscreen||frame.requestFullscreen)){
      fullscreenButton.hidden=true;
    }else{
      fullscreenButton.addEventListener("click",enterFullscreen);
      resetControlsIdle();
    }
  }
  if(retryButton)retryButton.addEventListener("click",retryNow);
  /* Comments are requested only after the game iframe has begun its eager load. */
  if(comments&&comments.dataset.src){comments.src=comments.dataset.src;comments.removeAttribute("data-src");}
  scheduleRetry();
})();