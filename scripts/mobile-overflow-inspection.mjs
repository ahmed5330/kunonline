// Browser-side geometry check: a wide descendant is reachable only when an
// actual horizontal scrolling ancestor is itself bounded by the viewport.
export function inspectMobileOverflow(root,viewportWidth=window.innerWidth){
  if(!root)return [];
  function visible(element){
    const style=getComputedStyle(element),rect=element.getBoundingClientRect();
    return style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)!==0&&rect.width>0&&rect.height>0;
  }
  function reachableInBoundedScroller(element){
    for(let parent=element.parentElement;parent&&parent!==root;parent=parent.parentElement){
      const style=getComputedStyle(parent),rect=parent.getBoundingClientRect();
      if(['auto','scroll'].includes(style.overflowX)&&parent.scrollWidth>parent.clientWidth+1&&
        rect.width<=viewportWidth+24&&rect.left>=-18&&rect.right<=viewportWidth+18)return true;
    }
    return false;
  }
  return [...root.querySelectorAll('*')].filter(element=>{
    if(!visible(element)||element.closest('.side:not(.mobile-open),.drawer:not(.open),.help-popover:not(.show)'))return false;
    const rect=element.getBoundingClientRect();
    if(!(rect.width>viewportWidth+24||rect.left < -18||rect.right>viewportWidth+18))return false;
    return !reachableInBoundedScroller(element);
  }).slice(0,6).map(element=>{const rect=element.getBoundingClientRect();return {tag:element.tagName,cls:String(element.className||'').slice(0,90),w:Math.round(rect.width),left:Math.round(rect.left),right:Math.round(rect.right)};});
}
