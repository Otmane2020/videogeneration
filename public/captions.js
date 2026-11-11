'use strict';
(() => {
  const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
  const round=(ctx,x,y,w,h,r,fill)=>{ctx.beginPath(); if(ctx.roundRect)ctx.roundRect(x,y,w,h,r);else ctx.rect(x,y,w,h); if(fill)ctx.fill();};
  const styles=[
    ['karaoke','Karaoke Highlight'],['bold-pop','Bold Pop'],['typewriter','Typewriter'],['neon','Neon Glow'],['minimal','Minimal'],['highlight','Word Highlight'],['editorial','Editorial'],['boxed','Caption Box'],['word','Word by Word'],['clean','Clean Lower Third']
  ];
  function draw(ctx,chunk,local,pos){
    const {x,y,width,wide,accent,font,style,backOut,easeOut}=pos;
    const size=wide?38:44, active=chunk.findIndex(w=>local>=w.t0&&local<w.t1), words=style==='typewriter'?chunk.slice(0,Math.max(1,active+1)):chunk;
    const only=style==='word'?chunk[Math.max(0,active)]:null;
    const text=words.map(w=>w.w).join(' ');
    ctx.save(); ctx.textAlign='center'; ctx.textBaseline='middle';
    if(style==='word'&&only){
      ctx.font=`900 ${size*1.18}px ${font}`; ctx.shadowColor=accent;ctx.shadowBlur=14;
      ctx.fillStyle=accent;ctx.fillText(only.w.toUpperCase(),x,y-size*.35,width);
    } else if(style==='editorial'){
      ctx.font=`700 ${size}px Georgia,serif`;ctx.fillStyle='#fff';ctx.shadowColor='#000';ctx.shadowBlur=14;
      ctx.fillText(text,x,y,width);
    } else if(style==='minimal'){
      ctx.font=`700 ${size*.9}px ${font}`;ctx.fillStyle='#fff';ctx.shadowColor='#000';ctx.shadowBlur=13;ctx.fillText(text,x,y,width);
    } else if(style==='clean'){
      ctx.font=`700 ${size*.72}px ${font}`;const w=Math.min(width-12,ctx.measureText(text).width+44);
      ctx.fillStyle='rgba(8,8,14,.76)';round(ctx,x-w/2,y-size*.48,w,size*1.05,12,true);
      ctx.fillStyle='#fff';ctx.fillText(text,x,y,width-28);
    } else {
      ctx.font=`900 ${size}px ${font}`;
      const upper=words.map(w=>w.w.toUpperCase()), widths=upper.map(t=>ctx.measureText(t).width+size*.34);
      const gap=style==='boxed'?size*.18:size*.12, total=widths.reduce((a,b)=>a+b,0)+gap*(upper.length-1), fit=Math.min(1,(width-16)/total);
      let cursor=x-total*fit/2;
      if(style==='boxed'){
        const boxW=Math.min(width-8,total*fit+26);ctx.fillStyle='rgba(7,7,14,.82)';round(ctx,x-boxW/2,y-size*.62,boxW,size*1.25,14,true);
      }
      words.forEach((wd,i)=>{
        const on=local>=wd.t0&&local<wd.t1, tw=widths[i]*fit, cx=cursor+tw/2;
        const pop=style==='bold-pop'&&on?1.16:1, k=style==='bold-pop'?backOut((local-wd.t0+.08)/.16):1;
        ctx.save();ctx.translate(cx,y);ctx.scale(pop*(style==='bold-pop'?.88+.12*k:1),pop*(style==='bold-pop'?.88+.12*k:1));
        if(style==='highlight'&&on){ctx.fillStyle=accent;round(ctx,-tw*.54,-size*.53,tw*1.08,size*1.08,8,true);ctx.fillStyle='#101018';}
        else if(style==='boxed')ctx.fillStyle=on?accent:'#fff';
        else ctx.fillStyle=on?accent:'#fff';
        if(style==='neon'){ctx.shadowColor=accent;ctx.shadowBlur=on?24:8;}
        if(style==='typewriter')ctx.globalAlpha=on?.95:1;
        if(style!=='highlight'||!on){ctx.lineWidth=style==='neon'?2:8;ctx.strokeStyle='rgba(0,0,0,.76)';ctx.strokeText(upper[i],0,0);}
        ctx.fillText(upper[i],0,0);ctx.restore();cursor+=tw+gap*fit;
      });
    }
    ctx.restore();
  }
  window.ClipMotionCaptions={styles,draw};
})();
