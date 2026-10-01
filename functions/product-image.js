'use strict';
const sharp=require('sharp');
const {ApiError}=require('./core');
async function optimizeProductImage(input){
 if(!Buffer.isBuffer(input)||!input.length||input.length>8*1024*1024)throw new ApiError(400,'IMAGE_SIZE','8MB 이하 이미지 파일이 필요합니다.');
 try{
  const image=sharp(input,{limitInputPixels:40000000,animated:false}),meta=await image.metadata();
  if(!['jpeg','png','webp'].includes(meta.format)||meta.pages>1)throw Error();
  const {data,info}=await image.rotate().resize({width:1800,height:1800,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer({resolveWithObject:true});
  return {data,width:info.width,height:info.height,bytes:data.length,sourceBytes:input.length};
 }catch{throw new ApiError(400,'IMAGE_FORMAT','올바른 JPEG, PNG, WebP 이미지를 선택해주세요. (최대 4천만 화소)');}
}
module.exports={optimizeProductImage};
