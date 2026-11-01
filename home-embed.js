(function(){
  "use strict";

  var frame=document.getElementById("igi-siteb-frame");
  var loader=document.getElementById("igi-loader");
  var status=document.getElementById("igi-loader-status");
  var retryButton=document.getElementById("igi-retry");
  var wrapper=document.querySelector(".igi-game-shell");
  var fullscreenButton=document.getElementById("igi-fullscreen");
  var comments=document.getElementById("disqus-frame");

  if(!frame||!loader||!wrapper)return;

  var workerOrigin="https://broken-salad-30b8.editingking-2977.workers.dev";
  var ready=false;
  var attempt=1;
  var maxAttempts=3;
  var retryTimer=null;
  var pingTimer=null;
  var pingStopTimer=null;
  var idleTimer=null;
  var debugTimer=null;
  var startedAt=Date.now();
  var iframeLoaded=false;
  var lastMessageType="none";
  var lastMessageOrigin="none";
  var debugMode=new URLSearchParams(window.location.search).get("igidebug")==="1";
  var debugLine=document.getElementById("igi-debug");

  function updateDebug(){
    if(!debugMode||!debugLine)return;
    var seconds=Math.floor((Date.now()-startedAt)/1000);
    debugLine.textContent="IFRAME LOAD: "+(iframeLoaded?"YES":"NO")+
      " | LAST: "+lastMessageType+
      " | ORIGIN: "+lastMessageOrigin+
      " | ELAPSED: "+seconds+"S"+
      " | ATTEMPT: "+attempt+"/"+maxAttempts;
  }

  if(debugMode&&debugLine){
    debugLine.hidden=false;
    updateDebug();
    debugTimer=window.setInterval(updateDebug,1000);
  }

  function clearRetryTimer(){
    if(retryTimer!==null){window.clearTimeout(retryTimer);retryTimer=null;}
  }

  function clearPingTimers(){
    if(pingTimer!==null){window.clearInterval(pingTimer);pingTimer=null;}
    if(pingStopTimer!==null){window.clearTimeout(pingStopTimer);pingStopTimer=null;}
  }

  function stopAllTimers(){
    clearRetryTimer();
    clearPingTimers();
    if(debugTimer!==null){window.clearInterval(debugTimer);debugTimer=null;}
  }

  function markReady(){
    if(ready)return;
    ready=true;
    stopAllTimers();
    document.body.classList.remove("igi-portal-loading");
    document.body.classList.add("igi-portal-loaded");
    loader.setAttribute("aria-hidden","true");
    if(status)status.textContent="MISSION LINK ESTABLISHED";
  }

  /* Install exactly one message listener. Height messages are readiness signals only. */
  window.addEventListener("message",function(event){
    var data=event.data;
    var type=data&&typeof data==="object"?data.type:"unknown";
    lastMessageType=String(type||"unknown");
    lastMessageOrigin=String(event.origin||"unknown");

    if(debugMode)console.info("[IGI homepage iframe message]",{
      type:type,
      origin:event.origin,
      data:data
    });
    updateDebug();

    if(event.origin!==workerOrigin)return;
    if(type!=="igi-ready"&&type!=="igi-height")return;

    try{
      if(event.source&&typeof event.source.postMessage==="function"){
        event.source.postMessage({type:"igi-ack"},workerOrigin);
      }
    }catch(error){}

    markReady();
  },false);

  function sendPing(){
    if(ready||!frame.contentWindow)return;
    try{frame.contentWindow.postMessage({type:"igi-ping"},workerOrigin);}catch(error){}
  }

  function startPingCycle(){
    clearPingTimers();
    if(ready)return;
    sendPing();
    pingTimer=window.setInterval(function(){
      if(ready){clearPingTimers();return;}
      sendPing();
    },500);
    pingStopTimer=window.setTimeout(clearPingTimers,40000);
  }

  frame.addEventListener("load",function(){
    iframeLoaded=true;
    updateDebug();
    startPingCycle();
  });

  function scheduleAttemptTimeout(){
    clearRetryTimer();
    retryTimer=window.setTimeout(function(){
      if(ready)return;
      if(attempt<maxAttempts){
        attempt++;
        if(status)status.textContent="CONNECTING... RETRYING // ATTEMPT "+attempt+" OF "+maxAttempts;
        updateDebug();
        frame.src=workerOrigin+"/?r="+Date.now();
        scheduleAttemptTimeout();
      }else{
        if(status)status.textContent="CONNECTION DELAYED // PRESS RETRY TO TRY AGAIN";
        updateDebug();
      }
    },25000);
  }

  function manualRetry(){
    if(ready)return;
    clearRetryTimer();
    clearPingTimers();
    attempt=1;
    startedAt=Date.now();
    iframeLoaded=false;
    lastMessageType="none";
    lastMessageOrigin="none";
    if(status)status.textContent="RECONNECTING // ATTEMPT 1 OF "+maxAttempts;
    updateDebug();
    frame.src=workerOrigin+"/?r="+Date.now();
    scheduleAttemptTimeout();
  }

  function resetControlsIdle(){
    wrapper.classList.remove("igi-controls-idle");
    if(idleTimer!==null)window.clearTimeout(idleTimer);
    idleTimer=window.setTimeout(function(){
      wrapper.classList.add("igi-controls-idle");
    },3000);
  }

  function enterFullscreen(){
    var request=wrapper.requestFullscreen||frame.requestFullscreen;
    if(typeof request!=="function")return;
    try{
      var target=wrapper.requestFullscreen?wrapper:frame;
      var result=request.call(target);
      if(result&&typeof result.catch==="function")result.catch(function(){});
    }catch(error){}
  }

  wrapper.addEventListener("pointerdown",function(event){
    if(event.target!==fullscreenButton&&event.target!==retryButton)frame.focus();
  });
  wrapper.addEventListener("pointermove",resetControlsIdle);
  wrapper.addEventListener("focusin",resetControlsIdle);

  if(fullscreenButton){
    if(!(wrapper.requestFullscreen||frame.requestFullscreen)){
      fullscreenButton.hidden=true;
    }else{
      fullscreenButton.addEventListener("click",enterFullscreen);
      resetControlsIdle();
    }
  }

  if(retryButton)retryButton.addEventListener("click",manualRetry);

  /* Keep the existing lazy comments initialization unchanged. */
  if(comments&&comments.dataset.src){
    comments.src=comments.dataset.src;
    comments.removeAttribute("data-src");
  }

  /* The original navigation is never interrupted; attempt one gets a full 25 seconds. */
  scheduleAttemptTimeout();
})();