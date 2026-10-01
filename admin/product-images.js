'use strict';
async function compressProductFile(file){
 if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('JPG, PNG, WebP 파일만 업로드할 수 있습니다.');
 if(!file.size||file.size>20*1024*1024)throw Error('원본 파일은 20MB 이하여야 합니다.');
 let bitmap;
 try{bitmap=await createImageBitmap(file);if(bitmap.width*bitmap.height>40000000)throw Error('이미지는 최대 4천만 화소까지 지원합니다.');
  const scale=Math.min(1,1800/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('이미지를 압축하지 못했습니다.')),'image/webp',0.85));
  const output=blob.size<file.size||scale<1?blob:file;
  if(output.size>8*1024*1024)throw Error('압축 후에도 파일이 큽니다. 더 작은 이미지를 선택해주세요.');return output;
 }finally{bitmap?.close();}
}
async function uploadProductFiles(files){
 const form=$('#productForm');if(!form||form.dataset.uploading==='true')return;
 const input=form.querySelector('#imageUpload'),zone=form.querySelector('#imageDropzone'),status=form.querySelector('#uploadStatus'),errors=form.querySelector('#uploadErrors');
 const list=[...files];if(!list.length)return;
 if(images.length+list.length>12){errors.textContent='이미지는 최대 12장입니다. 남은 '+(12-images.length)+'장 이내로 선택해주세요.';input.value='';return;}
 const version=renderVersion,targetImages=images;const live=()=>version===renderVersion&&form.isConnected&&images===targetImages;
 const buttons=[...form.querySelectorAll('button')];form.dataset.uploading='true';form.setAttribute('aria-busy','true');input.disabled=true;zone.classList.add('busy');buttons.forEach(b=>{b.dataset.wasDisabled=String(b.disabled);b.disabled=true;});errors.textContent='';
 let success=0,totalBefore=0,totalAfter=0;const failed=[];
 try{for(let i=0;i<list.length;i++){
  if(!live())break;const file=list[i];
  try{status.textContent=`${i+1} / ${list.length} · ${file.name} 압축 중…`;const blob=await compressProductFile(file);if(!live())break;
   status.textContent=`${i+1} / ${list.length} · ${file.name} 업로드 중…`;
   const response=await fetch('/api/admin/images',{method:'POST',credentials:'same-origin',headers:{'X-CSRF-Token':csrf,'Content-Type':blob.type},body:blob,signal:AbortSignal.timeout(60000)});const data=await response.json();if(!response.ok)throw Error(data.message||'업로드에 실패했습니다.');if(!live())break;
   targetImages.push({...data,name:file.name,originalBytes:file.size,preview:'/api/admin/images/'+data.id});success++;totalBefore+=file.size;totalAfter+=data.bytes;drawImages();form.querySelectorAll('[data-image-up],[data-image-remove]').forEach(b=>b.disabled=true);
  }catch(e){failed.push(file.name+': '+(e.name==='AbortError'||e.name==='TimeoutError'?'응답 시간이 초과됐습니다. 다시 선택해주세요.':e.message));}
 }
 if(live()){status.textContent=success?`${success}장 업로드 완료 · ${imageSize(totalBefore)} → ${imageSize(totalAfter)}. 상품을 저장하면 반영됩니다.`:'업로드된 이미지가 없습니다.';errors.textContent=failed.join('\n');}
 }finally{form.dataset.uploading='false';form.removeAttribute('aria-busy');input.disabled=false;input.value='';zone.classList.remove('busy','drag-over');buttons.forEach(b=>{b.disabled=b.dataset.wasDisabled==='true';delete b.dataset.wasDisabled;});if(live())drawImages();}
}
document.addEventListener('change',e=>{if(e.target.id==='imageUpload')void uploadProductFiles(e.target.files);});
let dragDepth=0;
document.addEventListener('dragover',e=>{if(!$('#productForm')||!Array.from(e.dataTransfer?.types||[]).includes('Files'))return;e.preventDefault();const zone=e.target.closest('#imageDropzone');if(zone){e.dataTransfer.dropEffect='copy';zone.classList.add('drag-over');}});
document.addEventListener('dragenter',e=>{const zone=e.target.closest('#imageDropzone');if(!zone)return;e.preventDefault();dragDepth++;zone.classList.add('drag-over');});
document.addEventListener('dragleave',e=>{const zone=e.target.closest('#imageDropzone');if(!zone)return;dragDepth--;if(dragDepth<=0){dragDepth=0;zone.classList.remove('drag-over');}});
document.addEventListener('drop',e=>{if(!$('#productForm'))return;e.preventDefault();dragDepth=0;const zone=$('#imageDropzone');zone?.classList.remove('drag-over');if(e.target.closest('#imageDropzone'))void uploadProductFiles(e.dataTransfer.files);});
