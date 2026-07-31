/* ============================================================
   语桥 ReadBridge — 主应用逻辑
   版本: v1.7 (IIFE封装)
   
   架构: IIFE 包裹全局状态 → 仅暴露 HTML onclick 需要的函数到 window
   ============================================================ */

(function() {
'use strict';

// ============================================================
// 0. 配置
// ============================================================
const SUPABASE_URL = 'https://hgdmyrkdxcnduxhbezfd.supabase.co';
const SUPABASE_KEY = 'sb_publishable_bXidjI4JfQ3r224M2cRcLw_1gNSpo0C';
const API_BASE = SUPABASE_URL + '/functions/v1';  // Edge Functions API 网关

// ========== 下载原文（输出标准化版本）==========
function downloadBook(){
  if(!curBook||!curBook.zh)return;
  const text=normalizeText(curBook.zh.join('\n\n'));
  const blob=new Blob([text],{type:'text/plain;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download=(curBook.title||'download')+'.txt';a.click();
  URL.revokeObjectURL(a.href);
}

// ========== 上传翻译 ==========
let transUpText=null,transUpParas=null;
function openTransUp(){
  if(!session||!curBook){alert('请先打开一本书并登录');return;}
  var el=document.getElementById('transUpParaCount');if(el)el.textContent=curBook.zh.length;
  el=document.getElementById('promptParaCount');if(el)el.textContent=curBook.zh.length;
  el=document.getElementById('transUpResult');if(el)el.textContent='';
  el=document.getElementById('transUpPaste');if(el)el.value='';
  el=document.getElementById('transUpFile');if(el)el.value='';
  transUpText=null;transUpParas=null;
  el=document.getElementById('transUpM');if(el)el.classList.add('on');
}
function closeTransUp(){var el=document.getElementById('transUpM');if(el)el.classList.remove('on');}
function copyPrompt(){
  var count=curBook&&curBook.zh?curBook.zh.length:0;
  var text='请将以下中文文本翻译成英文。\n\n要求：\n1. 保持原文的段落结构，每个段落之间用空行（两个换行）分隔\n2. 不要合并或拆分段落\n3. 不要添加任何解释、注释或额外文字\n4. 只输出英文译文\n5. 原文共 '+count+' 段，请确保输出也是相同的段落数\n\n---\n[在此粘贴下载的 TXT 全文]';
  navigator.clipboard.writeText(text).then(function(){alert('✅ 提示词已复制！\n\n使用方法：\n1. 粘贴到 ChatGPT/Claude 中\n2. 把 [在此粘贴...] 替换为下载的 TXT 全文\n3. 发送，保存输出为 .txt，上传回网站');});
}

function previewTransFile(){
  var el=document.getElementById('transUpFile');if(!el||!el.files[0])return;
  var r=new FileReader();r.onload=function(e){transUpText=e.target.result;transUpParas=smartSplit(transUpText);showTransMatch();};r.readAsText(el.files[0],'UTF-8');
}
// 提取章节锚点（用于翻译对齐）
function extractChapterAnchors(paras){
  const anchors=[];
  paras.forEach((p,i)=>{
    const titleMatch=p.match(/第[一二三四五六七八九十百千\d]+[章节回]/)||p.match(/^[一二三四五六七八九十百千]{1,3}[\.\、\s]/)||p.match(/chapter\s*\d+/i);
    if(titleMatch)anchors.push({title:titleMatch[0],index:i});
  });
  return anchors;
}

function showTransMatch(){
  if(!transUpParas||!curBook||!curBook.zh)return;
  var orig=curBook.zh.length,trans=transUpParas.length,diff=Math.abs(orig-trans);
  var el=document.getElementById('transUpResult');if(!el)return;
  // 章节锚点检测
  var origAnchors=extractChapterAnchors(curBook.zh);
  var transAnchors=extractChapterAnchors(transUpParas);
  var anchorMatch=(origAnchors.length>0&&origAnchors.length===transAnchors.length&&Math.abs(origAnchors.length-transAnchors.length)<2);
  var ok=diff===0||(diff<=15&&orig>20)||(anchorMatch&&diff<=orig*0.1);
  el.innerHTML=ok
    ?'<span style="color:var(--grammar-prep)">✅ 匹配通过：原文'+orig+'段，翻译'+trans+'段（差异'+diff+'段）'+(anchorMatch?' · 章节锚点'+origAnchors.length+'个匹配':'')+'</span>'
    :'<span style="color:#dc2626">❌ 段落数不匹配：原文'+orig+'段，翻译'+trans+'段（差异'+diff+'段）。'+(anchorMatch?'章节锚点匹配但段落数差异较大。':'')+'请检查翻译文件。</span>';
}
async function doTransUp(){
  if(!transUpText||!transUpParas){alert('请先选择翻译文件或粘贴译文');return;}
  if(!curBook||!curBook.zh){alert('请先打开一本书');return;}
  var orig=curBook.zh.length,trans=transUpParas.length;
  // 放宽限制：章节锚点匹配或段落数接近
  var origAnchors=extractChapterAnchors(curBook.zh);
  var transAnchors=extractChapterAnchors(transUpParas);
  var anchorOk=origAnchors.length>0&&Math.abs(origAnchors.length-transAnchors.length)<=2;
  if(!anchorOk&&Math.abs(orig-trans)>15&&orig>20){alert('段落数差异过大（原文'+orig+'段，翻译'+trans+'段），请确保翻译保持了相同的段落结构。\n\n章节锚点数：原文'+origAnchors.length+'个，翻译'+transAnchors.length+'个。');return;}
  if(!db){alert('数据库未连接');return;}
  try{
    // 章节对齐上传：优先按锚点映射
    var count=Math.min(orig,trans);
    if(anchorOk&&origAnchors.length===transAnchors.length){
      // 章内段落等比例映射
      for(var a=0;a<origAnchors.length;a++){
        var origStart=origAnchors[a].index;
        var origEnd=(a+1<origAnchors.length)?origAnchors[a+1].index:orig;
        var transStart=transAnchors[a].index;
        var transEnd=(a+1<transAnchors.length)?transAnchors[a+1].index:trans;
        var origLen=origEnd-origStart,transLen=transEnd-transStart;
        for(var k=0;k<Math.min(origLen,transLen);k++){
          var oi=origStart+k;
          var ti=transStart+Math.round(k*(transLen/Math.max(origLen,1)));
          if(oi<orig&&ti<trans){
            // 批量插入
            var batch=[];
            batch.push({book_id:curBook.id,paragraph_index:oi,language:'en',version:1,author_name:profile?profile.username:'AI',content:transUpParas[ti]});
            await db.from('translations').insert(batch);
          }
        }
      }
    }else{
      // 退化为序号对齐
      for(var i=0;i<count;i+=100){
        var batch=[];
        for(var j=i;j<Math.min(i+100,count);j++){batch.push({book_id:curBook.id,paragraph_index:j,language:'en',version:1,author_name:profile?profile.username:'AI',content:transUpParas[j]});}
        await db.from('translations').insert(batch);
      }
    }
    closeTransUp();await loadCloudVersions();renderR();showReport();
    alert('✅ 翻译上传成功！共'+count+'段译文已导入。');
  }catch(e){alert('上传失败：'+e.message);}
}


// ============================================================
// 1. 数据库连接与降级管理
// ============================================================
let db = null;
let dbOnline = false;  // 数据库是否实际可用（区别于客户端对象是否创建）

try {
  if(typeof supabase!=='undefined'){
    db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }
} catch(e){ console.error('Supabase init failed'); }

// 检测数据库是否真正在线
async function checkDBOnline(){
  if(!db) return false;
  try{
    const start = Date.now();
    const{data,error} = await db.from('books').select('id').limit(1).abortSignal(AbortSignal.timeout(5000));
    if(error) throw error;
    dbOnline = true;
    updateDBStatus('online');
    return true;
  }catch(e){
    dbOnline = false;
    updateDBStatus('offline');
    return false;
  }
}

function updateDBStatus(state){
  const el = document.getElementById('dbStatus');
  if(!el) return;
  if(state==='online'){
    el.textContent = '✅ 已连接';
    el.style.color = 'var(--grammar-prep)';
  }else if(state==='offline'){
    el.textContent = '⚠ 离线（仅可阅读预置书）';
    el.style.color = '#f59e0b';
  }else{
    el.textContent = '⏳ 连接中';
    el.style.color = 'var(--s)';
  }
}

// 资料库离线提示横幅
function showOfflineBanner(){
  const lib = document.getElementById('libPage');
  if(!lib) return;
  // 移除旧横幅
  const old = document.getElementById('offlineBanner');
  if(old) old.remove();
  
  const banner = document.createElement('div');
  banner.id = 'offlineBanner';
  banner.style.cssText = 'background:#fef3c7;border:1px solid #f59e0b;border-radius:10px;padding:10px 16px;margin-bottom:14px;text-align:center;font-size:0.85em;color:#92400e;display:flex;align-items:center;justify-content:center;gap:8px';
  banner.innerHTML = '⚠️ 数据库离线 — 仅可阅读预置书籍。上传、翻译改进、评论等功能暂不可用。';
  const firstChild = lib.children[0];
  if(firstChild) lib.insertBefore(banner, firstChild);
}

function hideOfflineBanner(){
  const banner = document.getElementById('offlineBanner');
  if(banner) banner.remove();
}

function requireDB(){ 
  if(!db){ 
    alert('后端服务暂未连接，请刷新页面后重试。\n\n如多次失败，请检查网络连接。'); 
    return false; 
  }
  if(!dbOnline){
    alert('数据库当前离线。预置书籍可以正常阅读，但此功能需要联网。\n\n请稍后重试。');
    return false;
  }
  return true; 
}

let session = null;
let profile = null;

// ============================================================
// 2. 预置书籍数据（即时加载，不依赖API）
// ============================================================
const PRELOAD = {
  'little-prince':{
    title:'小王子',author:'圣-埃克苏佩里',genre:'名著',cover:'🌟',desc:'全球销量仅次于圣经的童话，被翻译成300多种语言。',wordCount:3150,
    zh:[
      '当我还只有六岁的时候，在一本描写原始森林的名叫《真实的故事》的书中，看到了一幅精彩的插画，画的是一条蟒蛇正在吞食一头野兽。书中写道："蟒蛇会把猎物整个吞进去，完全不咀嚼。然后它们就无法动弹了，要花六个月的时间边睡觉边消化。"',
      '当时，我对丛林中的奇遇思考了很多。于是，我也用彩色铅笔，画出了我的第一幅画。我的作品一号。我把我的杰作拿给大人们看，问他们我的画是不是让他们害怕。他们却回答："一顶帽子有什么好怕的？"',
      '我画的不是一顶帽子。我画的是一条蟒蛇正在消化一头大象。于是我又把蟒蛇肚子里的情况画了出来，好让大人们能够看懂。这些大人啊，总是需要解释。我的作品二号画完后，大人们劝我把这些开着肚皮或闭着肚皮的蟒蛇画丢在一边。',
      '大人们劝我还是把心思放在地理、历史、算术和语法上。就这样，在六岁那年，我放弃了当画家这一美好的职业。我的作品一号和作品二号没获得成功，这让我泄了气。这些大人们，靠他们自己什么也弄不懂，总是需要不断地给他们解释，这真叫孩子们厌烦。',
      '所以后来，我只好选择了另外一个职业——我学会了开飞机，差不多飞遍了整个世界。的确，地理学帮了我的大忙。我一眼就能分辨出中国和亚利桑那。要是夜里迷失了航向，这是很有用的。我在大人们中间生活过很长时间，仔细地观察过他们，但这并没有使我对他们的看法有多大的改变。',
      '当我遇到一个头脑看来稍微清楚的大人时，我就拿出一直保存着的作品一号来测试他。可是，得到的回答总是："这是顶帽子。"我就不和他谈巨蟒、原始森林或者星星之类的事。我只得迁就他们的水平，和他们谈些桥牌、高尔夫球、政治和领带。于是大人们就十分高兴能认识我这样一个通情达理的人。',
    ],
    en:[
      "Once when I was six years old I saw a magnificent picture in a book about the primeval forest, called True Stories. It showed a boa constrictor swallowing a wild beast. In the book it said: \"Boa constrictors swallow their prey whole, without chewing. After that they are not able to move, and they sleep through the six months that they need for digestion.\"",
      "I pondered deeply over the adventures of the jungle, and after some work with a colored pencil I succeeded in making my first drawing. I showed my masterpiece to the grown-ups and asked whether it frightened them. But they answered: \"Frighten? Why should anyone be frightened by a hat?\"",
      "My drawing was not a picture of a hat. It was a picture of a boa constrictor digesting an elephant. So I drew the inside of the boa constrictor to help the grown-ups understand. They always need explanations. After Drawing Number Two, the grown-ups advised me to put aside my drawings of boa constrictors.",
      "The grown-ups advised me to devote myself instead to geography, history, arithmetic and grammar. That is why, at the age of six, I gave up what might have been a magnificent career as a painter. I had been disheartened by the failure of my drawings. Grown-ups never understand anything by themselves, and it is exhausting for children to be always explaining things to them.",
      "So then I chose another profession, and learned to pilot airplanes. I have flown a little over all parts of the world. Geography has been very useful to me — at a glance I can distinguish China from Arizona. If one gets lost in the night, such knowledge is valuable. I have lived a great deal among grown-ups, seen them intimately, close at hand. And that hasn't much improved my opinion of them.",
      "Whenever I met one who seemed at all clear-sighted, I tried showing him my Drawing Number One, which I have always kept. But whoever it was would always say: \"That is a hat.\" Then I would never talk to that person about boa constrictors, or primeval forests, or stars. I would bring myself down to his level and talk about bridge, golf, politics, and neckties. And the grown-up would be greatly pleased to have met such a sensible man.",
    ],
    ja:[
      '私が六歳のとき、原生林についての本の中で、ボアという大蛇が野獣を飲みこもうとしている素晴らしい絵を見つけました。「ボアは獲物をかまずにまるのみにし、消化するために六か月ものあいだ眠る」と書いてありました。',
      '私はジャングルの冒険について深く考え、色鉛筆で最初の絵を描きました。作品第一号です。大人たちにこの傑作を見せると、「帽子がどうしてこわいんだい？」と答えました。',
      '私の絵は帽子ではなく、ゾウを消化しているボアの絵でした。大人たちにもわかるようにボアのおなかのなかを描きました。大人たちはいつも説明が必要です。すると、ボアの絵はやめるようにと言われました。',
      '大人たちは地理や歴史、算数や文法に専念しろと言いました。六歳で画家の夢をあきらめました。大人たちは自分では何もわからず、いつも説明しなければならないのは、子どもにとって本当にうんざりすることです。',
      'そこで私は飛行機の操縦を覚え、世界中を飛びまわりました。地理学がとても役立ちました。一目で中国とアリゾナを見分けられます。大人たちのあいだで長く暮らし、彼らを間近で観察しましたが、意見が変わることはありませんでした。',
      '少しでも話のわかる大人に出会うと、大切に持っている作品第一号を見せました。でも返事はいつも「これは帽子だね」。それでボアや原生林や星の話はやめて、ブリッジやゴルフや政治やネクタイの話をしました。大人たちはこんな分別のある人と知り合えてとても喜ぶのでした。',
    ],
    ko:[
      '내가 여섯 살 때, 원시림에 관한 책에서 보아뱀이 야수를 삼키는 멋진 그림을 보았다. 책에는 "보아뱀은 먹이를 씹지 않고 통째로 삼키며, 소화하는 데 6개월 동안 잠을 잔다"라고 쓰여 있었다.',
      '나는 정글의 모험에 대해 깊이 생각한 후 색연필로 첫 그림을 그렸다. 작품 1호. 어른들에게 보여주자 "모자가 뭐가 무섭다고?"라고 대답했다.',
      '내 그림은 모자가 아니라 코끼리를 소화하는 보아뱀이었다. 어른들이 이해할 수 있도록 뱀의 배 속을 그렸다. 어른들은 항상 설명이 필요하다. 그러자 어른들은 보아뱀 그림을 그만두라고 했다.',
      '어른들은 지리, 역사, 산수, 문법에 전념하라고 충고했다. 여섯 살에 화가의 꿈을 포기했다. 어른들은 스스로 아무것도 이해하지 못하고, 아이들이 끊임없이 설명해야 하는 것은 정말 지치는 일이다.',
      '그래서 나는 비행기 조종을 배워 전 세계를 날아다녔다. 지리학이 큰 도움이 되었다. 한눈에 중국과 애리조나를 구별할 수 있다. 어른들 사이에서 오래 살며 그들을 가까이서 관찰했지만, 내 의견이 크게 바뀌지는 않았다.',
      '분별력 있어 보이는 어른을 만날 때마다 작품 1호를 보여주었다. 하지만 대답은 항상 "이건 모자네". 그래서 보아뱀이나 원시림이나 별 이야기는 하지 않고, 브리지, 골프, 정치, 넥타이 이야기를 했다. 어른들은 그렇게 분별 있는 사람을 만나 크게 기뻐했다.',
    ],
  },
  'border-town':{
    title:'边城',author:'沈从文',genre:'名著',cover:'🏔️',desc:'沈从文代表作。以湘西小城茶峒为背景，讲述翠翠与傩送的纯美爱情。中国现代文学最唯美的中篇小说。',wordCount:2950,
    zh:[
      '由四川过湖南去，靠东有一条官路。这官路将近湘西边境到了一个地方名为"茶峒"的小山城时，有一小溪，溪边有座白色小塔，塔下住了一户单独的人家。这人家只一个老人，一个女孩子，一只黄狗。',
      '小溪流下去，绕山岨流去了约三里便汇入茶峒的大河。溪流如弓背，山路如弓弦。小溪宽约二十丈，河床为大片石头作成。静静的水即或深到一篙不能落底，却依然清澈透明，河中游鱼来去皆可以计数。',
      '这渡船一次连人带马，约可以载二十位搭客过河。渡船头竖了一枝小小竹竿，挂着一个可以活动的铁环，溪岸两端水槽牵了一段废缆，有人过渡时，把铁环挂在废缆上，船上人就引手攀缘那条缆索，慢慢的牵船过对岸去。管理这渡船的，就是住在塔下的那个老人。活了七十年，从二十岁起便守在这小溪边，五十年来不知把船来去渡了若干人。',
      '女孩子的母亲，老船夫的独生女，十五年前同一个茶峒军人唱歌相熟，很秘密的背着那忠厚爸爸发生了暧昧关系。有了小孩子后，军人想约她一同逃去。但军人见她无远走勇气，自己也不便毁去作军人的名誉，首先服了毒。女的却关心腹中的肉，不忍心随他而去。',
      '事情被作渡船夫的父亲知道，父亲却不加上一个有分量的字眼儿，仍然把日子很平静的过下去。女儿一面怀了羞惭一面却怀了怜悯，仍守在父亲身边。待到腹中小孩生下后，却到溪边吃了许多冷水死去了。在一种近于奇迹中，这遗孤居然已长大成人，一转眼间便十三岁了。',
      '为了住处两山多篁竹，翠色逼人而来，老船夫随便为这可怜的孤雏拾取了一个近身的名字，叫作"翠翠"。翠翠在风日里长养着，把皮肤变得黑黑的，触目为青山绿水，一对眸子清明如水晶。自然既长养她且教育她，为人天真活泼，处处俨然如一只小兽物。',
    ],
    en:[
      "An old imperial highway running east from Sichuan into Hunan leads to a little mountain town called Chadong. By a narrow stream was a white pagoda, below which lived a solitary family: an old man, a girl, and a yellow dog.",
      "The stream wound downstream for three li before joining Chadong's great river. It was like the back of a bow; the mountain path was its string. About twenty zhang wide, the stream flowed over boulders. The water was so deep a pole could not reach bottom, yet so clear you could count the fish.",
      "The ferryboat carried about twenty passengers at a time. On the bow stood a bamboo pole with a movable iron ring. An old cable spanned the stream. To cross, one placed the ring over the cable and pulled hand over hand, drawing the boat across. The ferryman was the old man beneath the pagoda — seventy years old, he had kept the ferry since he was twenty.",
      "The girl's mother, the ferryman's only daughter, had become involved with a soldier from Chadong fifteen years earlier. After she was with child, the soldier wanted them to flee, but seeing she lacked resolve and unwilling to destroy his honor, he took poison first.",
      "When the ferryman learned of it, he added not a word of reproach and went on quietly. The daughter, carrying shame and pity, stayed by her father. After the child was born, she went to the stream and drank cold water until she died. By a near miracle, the orphan survived and soon turned thirteen.",
      "Because the mountains around their home were thick with bamboo, their kingfisher-blue pressing in on the eyes, the old ferryman named the orphan Cuicui — \"Jade Green.\" Raised by wind and sun, her skin grew dark. With green hills and clear waters before her eyes, her gaze was as limpid as crystal. Nature raised and taught her; she was innocent and lively, like a little wild creature.",
    ],
  },
  'doupo':{
    title:'斗破苍穹',author:'天蚕土豆',genre:'网文',cover:'🔥',desc:'中国网络文学史上最具影响力的玄幻小说。天才少年萧炎从云端跌落谷底后逆天改命的热血故事。"三十年河东，三十年河西，莫欺少年穷！"',wordCount:3100,
    zh:[
      '"斗之力，三段！"望着测验魔石碑上面闪亮得甚至有些刺眼的五个大字，少年面无表情，唇角有着一抹自嘲，紧握的手掌，因为大力，而导致略微尖锐的指甲深深的刺进了掌心之中，带来一阵阵钻心的疼痛……',
      '"萧炎，斗之力，三段！级别：低级！"测验魔石碑之旁，一位中年男子语气漠然的将之公布了出来。话刚刚脱口，便在人头汹涌的广场上带起了一阵嘲讽的骚动。"三段？嘿嘿，这个天才这一年又是在原地踏步！""哎，这废物真是把家族的脸都给丢光了。""要不是族长是他的父亲，这种废物早就被驱赶出家族了。"',
      '"唉，昔年那名闻乌坦城的天才少年，如今怎么落魄成这般模样了？""谁知道呢，或许做了什么亏心事，惹得神灵降怒了吧……"周围传来的不屑嘲笑，落在少年耳中，恍如一根根利刺狠狠的扎在心脏一般。少年缓缓抬起头来，露出一张有些清秀的稚嫩脸庞，漆黑的眸子木然的扫过那些嘲讽的同龄人。',
      '"这些人，都如此刻薄势力吗？或许是因为三年前他们曾经在自己面前露出过最谦卑的笑容，所以如今想要讨还回去吧……"苦涩的一笑，萧炎落寞的转身，安静的回到了队伍的最后一排，孤单的身影，与周围的世界，有些格格不入。"下一个，萧媚！"',
      '少女快速上前，小手轻车熟路的触摸着漆黑的魔石碑，缓缓闭上眼睛。片刻之后，魔石碑之上再次亮起了光芒。"斗之气：七段！""萧媚，斗之气：七段！级别：高级！"听着测验员的声音，窃窃私语又响了起来。"七段斗之气，了不起，顶多三年她就能成为一名真正的斗者。"',
      '测验继续。进行到一半左右时，人群中忽然骚动了起来。"萧薰儿要上场了！"所有的目光瞬间汇聚到一位身着紫色衣裙的少女身上。少女清冷淡然的气质，犹如清莲初绽，小小年纪已初具脱俗气质。她便是萧家除了萧炎以外最耀眼的天才——萧薰儿。',
    ],
    en:[
      "\"Dou Zhi Li: third stage!\" Gazing at the five large, glaringly bright characters on the Magic Test Monument, the young man's face showed no emotion. A trace of self-mockery flickered at his lips. His clenched fists drove his sharp nails deep into his palms, sending stabs of pain through his body.",
      "\"Xiao Yan — Dou Zhi Li, third stage. Level: Low!\" Beside the monument, a middle-aged man announced in an indifferent tone. A predictable wave of mockery rippled through the crowd. \"Third stage again! This 'genius' hasn't improved one bit!\" \"That loser is bringing shame on our whole clan.\" \"If his father weren't the clan leader, they'd have thrown him out long ago.\"",
      "\"The once-famous genius of Wutan City, reduced to this.\" \"Maybe the gods are punishing him...\" The scornful jeers reached the boy, driving into his heart like needles. Slowly he raised his head, revealing a youthful face. His dark eyes swept woodenly across the mocking faces of his peers.",
      "\"Are these people really so cruel and snobbish? Maybe because three years ago they all showed me their humblest smiles... and now they want to take it all back.\" With a bitter smile, Xiao Yan turned and walked quietly to the back of the line. His solitary figure seemed out of place. \"Next — Xiao Mei!\"",
      "The girl stepped forward, her small hand expertly touching the dark monument. She closed her eyes. Moments later, it lit up. \"Dou Zhi Qi: seventh stage! Level: High!\" Whispers erupted. \"Seventh stage — impressive! At this rate she'll be a true Dou Zhe within three years. The Xiao clan finally has a worthy successor.\"",
      "The testing continued. About halfway through, a stir rippled through the crowd. \"Xiao Xun'er is up!\" All eyes converged on a girl in a violet dress. Her cool, serene demeanor was like a lotus just beginning to bloom. Young as she was, she already possessed an otherworldly grace — the Xiao clan's brightest genius after Xiao Yan.",
    ],
  },
  'quanzhi':{
    title:'全职高手',author:'蝴蝶蓝',genre:'网文',cover:'🎮',desc:'电竞题材网络小说的巅峰之作。荣耀教科书级高手叶修被俱乐部驱逐后，重新组建战队重返巅峰。"如果喜欢，就把这一切当作是荣耀，而不是炫耀。"',wordCount:3050,
    zh:[
      '"咔咔咔，嗒嗒……"一双灵巧的手飞舞着操纵着键盘和鼠标，富有节奏的敲击声仿佛是一首轻快的乐章。屏幕中漫天的光华闪过，对手飞扬着血花倒了下去。"呵呵。"叶秋笑了笑，抬手取下了衔在嘴角的烟头。银白的烟灰已结成长长一串，但在操作过程中却没有被震落分毫。',
      '摘下的烟头很快被掐灭在烟灰缸里，叶秋的手飞快回到键盘，正准备对对手说点什么，房门却"咣"的一声被人推开了。叶秋没有回头，像是早就在等着这一刻："来了？""来了。"苏沐橙的回答也同样简单。"那就走吧！"',
      '叶秋拒绝了对手的再次邀战，从荣耀专用登录器上摘下了一张卡片，起身走到门口时顺手摘下了外套。夜已经挺深了，嘉世俱乐部却依旧灯火通明。叶秋和苏沐橙走出房间，一路走到了楼道的尽头——一间宽大的会议室，墙上巨大的电子显示屏显示着"荣耀职业联盟"的战绩排名。',
      '战绩排名：嘉世战队总排名第十九位，倒数第二。对于曾经创造过联赛三连霸的王牌战队，这个成绩分外刺眼。然而屋里气氛却一点不见沉闷，嘉世的队员们正众星捧月般地围绕着一个人。对于叶秋踏入会议室他们视而不见，眼神中全是冷漠和嘲笑。',
      '"叶秋，俱乐部已经决定，由新转会来的孙翔接替你的队长职务，一叶之秋今后也由孙翔来操控。"俱乐部经理看到叶秋进来，立刻回头说道。没有事先沟通，没有婉转表达，一来便是冰冷的通知。苏沐橙张口要说话，却被叶秋轻轻拉住，微笑着摇了摇头。',
      '"你喜欢这个游戏吗？"叶秋忽然转向孙翔问道。孙翔怔了一下，随即冷笑："当然喜欢，不然我为什么要来？""如果喜欢，就把这一切当作是荣耀，而不是炫耀。"叶秋说完转身朝门外走去，到门口时停了一下："一叶之秋……好好对她。"会议室里一片寂静。这个带领嘉世走向三连冠的男人，走出了他奋斗了七年的地方。',
    ],
    en:[
      "\"Click, click, tap, tap...\" A pair of nimble hands danced across keyboard and mouse. The rhythmic tapping was like a brisk musical movement. On the screen, a blaze of light flashed as the opponent fell in a spray of blood. \"Heh.\" Ye Qiu smiled and took the cigarette from his mouth. The silver-white ash had formed a long string, yet hadn't fallen during his intense play.",
      "He stubbed out the cigarette and his hands flew back to the keyboard. Just as he was about to speak to his opponent, the door burst open. Without turning around, as if he had been waiting for this: \"You came?\" \"I came,\" Su Mucheng replied just as simply. \"Then let's go.\"",
      "Ye Qiu declined another challenge, removed a card from the Glory login device, and grabbed his jacket on the way out. Though late at night, Excellent Era's clubhouse was still brightly lit. They walked to the end of the corridor — a spacious conference room. An enormous screen on the wall displayed the Glory Professional Alliance rankings.",
      "The standings: Excellent Era — 19th place, second from bottom. For a team that had achieved three consecutive championships, this was a glaring embarrassment. Yet the atmosphere was lively. The players were gathered around one person. They paid no attention to Ye Qiu; those who glanced at him showed only coldness and scorn.",
      "\"Ye Qiu, the club has decided. Sun Xiang will take over as captain. 'One Autumn Leaf' will be controlled by him from now on.\" The manager spoke the moment Ye Qiu entered — no prior discussion, just a cold notice. Su Mucheng opened her mouth to protest, but Ye Qiu gently held her back, smiled, and shook his head.",
      "\"Do you love this game?\" Ye Qiu suddenly turned to Sun Xiang. Sun Xiang sneered: \"Of course I do. Why else would I be here?\" \"If you love it, treat all of this as glory — not showing off.\" Ye Qiu turned and walked toward the door. At the threshold, he paused: \"One Autumn Leaf... take good care of her.\" Silence filled the room. The man who had led Excellent Era to three championships walked out of the place where he had fought for seven years.",
    ],
  },
  'neural-net':{
    title:'神经网络：从仿生大脑到数字神谕',author:'科普中国',genre:'科普',cover:'🧠',
    desc:'AI到底是如何诞生的？人工神经网络如何模拟人脑实现智能？一篇通俗易懂的科普。',wordCount:3150,
    zh:[
      '神经网络是一种模拟人脑神经元网络的计算架构。它的基本单元是"人工神经元"——每个神经元接收来自外部的数据（如图片、文本、语音），经过处理后输出结果。就像人脑中数百亿个神经元通过突触相互连接一样，人工神经网络由成千上万个这样的"神经元"层层堆叠而成，每一层提取不同层次的特征——底层识别边缘和颜色，中层识别形状，顶层识别物体。',
      '神经网络的历史可以追溯到1943年。当时神经生理学家麦卡洛克和数学家皮茨提出了第一个神经元数学模型，开创了人工神经网络研究的先河。但此后的几十年间，神经网络发展几经起伏。早期的感知机模型连简单的异或问题都无法解决，导致整个领域被冷落了将近二十年。直到1986年，反向传播算法的提出让多层网络得以有效训练，神经网络才重新回到研究者视野。',
      '真正让人工智能走进大众视野的，是2016年的AlphaGo。这款由DeepMind开发的围棋AI，以4:1击败了世界冠军李世石。比赛中AlphaGo下出了许多人类棋手从未见过的"神之一手"。赛后柯洁坦言："我唯一能感受到的是它对形势的乐观和自信，而且是绝对的乐观和自信，这一点人类是没有的。"这标志着深度神经网络在特定领域已经超越了人类。',
      '神经网络的核心机制是"学习"。它不是通过编程指令来执行任务，而是通过大量数据进行训练。以图像识别为例：系统会接收数百万张标注好的图片——"这是一只猫""这是一只狗"。神经网络通过不断调整内部参数，逐渐学会从像素中提取猫与狗的区别特征。这个过程类似于婴儿学习认识世界——看多了，自然就认得了。',
      '如今，神经网络已经渗透到生活的方方面面。人脸识别解锁手机、语音助手理解你的指令、推荐算法猜中你想看的内容——这些技术背后都是神经网络在运转。医疗领域，FDA批准的IDx-DR系统可以用神经网络分析视网膜照片，检测糖尿病视网膜病变，准确率超过90%。天文学领域，神经网络帮助科学家发现了多颗新的地外行星，准确率达到96%。',
      '但神经网络并非万能。它需要海量数据才能训练出好效果，而且"黑盒"特性让人难以理解其推理过程。MIT的研究发现，某些人脸识别系统对黑人女性的错误率高达35%——因为训练数据不够多样化。伯克利大学的Michael I. Jordan教授指出：AI在可预见的未来仍无法取代计算机科学的根本原理。OpenAI的Ilya Sutskever则认为，现在判断神经网络能走多远还为时过早——但有一件事可以确定，这项技术正在重塑我们与信息、与世界互动的方式。',
    ],
    en:[
      "A neural network is a computing architecture that mimics the brain's neural networks. Its basic unit is the \"artificial neuron\" — each neuron receives external data (images, text, speech), processes it, and outputs a result. Just as the human brain's hundreds of billions of neurons connect through synapses, artificial neural networks stack thousands of such neurons in layers, each extracting different levels of features — lower layers detect edges and colors, middle layers recognize shapes, and top layers identify objects.",
      "The history of neural networks dates back to 1943, when neurophysiologist McCulloch and mathematician Pitts proposed the first mathematical neuron model. But the field experienced dramatic ups and downs. Early perceptron models couldn't even solve simple XOR problems, causing the field to be largely abandoned for nearly two decades. It wasn't until 1986, when the backpropagation algorithm was introduced, that multi-layer networks could be effectively trained, reviving interest.",
      "What truly brought AI into public consciousness was AlphaGo in 2016. This Go-playing AI, developed by DeepMind, defeated world champion Lee Sedol 4:1. During the matches, AlphaGo made moves that no human player had ever seen — 'divine moves.' Afterwards, champion Ke Jie confessed: 'The only thing I could feel was its absolute optimism and confidence in its judgment — something no human possesses.' This marked the moment deep neural networks surpassed human ability in specific domains.",
      "The core mechanism of neural networks is 'learning.' They aren't programmed with explicit instructions but trained on massive amounts of data. In image recognition, for example, the system receives millions of labeled images — 'this is a cat,' 'this is a dog.' By continuously adjusting internal parameters, the network gradually learns to extract distinguishing features. This process resembles how infants learn to recognize the world — seeing enough examples teaches recognition.",
      "Today, neural networks permeate every aspect of life. Face recognition unlocks your phone, voice assistants understand your commands, recommendation algorithms guess what you want to watch — behind all of these are neural networks at work. In medicine, the FDA-approved IDx-DR system uses neural networks to analyze retinal photos for diabetic retinopathy with over 90% accuracy. In astronomy, neural networks have helped scientists discover new exoplanets with 96% accuracy.",
      "But neural networks are not all-powerful. They require vast amounts of data to train effectively, and their 'black box' nature makes their reasoning difficult to understand. MIT research found that certain facial recognition systems had error rates as high as 35% for Black women — because the training data wasn't diverse enough. Berkeley professor Michael I. Jordan notes that AI cannot replace the fundamental principles of computer science in the foreseeable future. OpenAI's Ilya Sutskever believes it's too early to judge how far neural networks can go — but one thing is certain: this technology is reshaping how we interact with information and with the world.",
    ],
  },
  'climate-change':{
    title:'地球正在发烧：气候变化科普',author:'科普中国',genre:'科普',cover:'🌍',
    desc:'过去百年全球升温0.74℃。温室效应如何发生？海平面上升有多严重？我们能做什么？',wordCount:3200,
    zh:[
      '过去几十年，地球的气候发生了巨大变化。全球气温持续上升，极端天气事件频繁发生，冰川加速消融，海平面不断升高——这些现象都指向一个事实：我们的地球正在"发烧"。2020年全球平均温度较工业化前高出约1.2℃，是有完整气象记录以来最暖的年份之一。这一切的根源，都与人类活动导致的温室气体排放密切相关。',
      '要理解全球变暖，首先需要了解"温室效应"。太阳辐射以可见光的形式穿透大气到达地球表面，地表吸收后以红外线的形式向外散发热量。然而，大气中的二氧化碳、甲烷等气体对红外线具有强烈的吸收能力，它们像温室的玻璃一样阻挡热量向外太空散发，使热量滞留在地球表面——这就是温室效应。若完全没有温室效应，地表平均温度将是零下18℃，而非现在宜人的15℃。但工业革命以来，人类活动使温室气体浓度急剧上升，温室效应过度加剧，地球因此持续变暖。',
      '主要的温室气体有四类：二氧化碳、甲烷、氧化亚氮和卤代烃气体。工业革命前，大气中二氧化碳浓度稳定在约280ppm，2022年已飙升至418ppm——主要来自煤炭、石油、天然气的燃烧和森林砍伐。甲烷的温室效应是二氧化碳的20至60倍，主要来自垃圾填埋、水稻田、牛羊反刍和天然气泄漏。氧化亚氮来自农业土壤和氮肥使用。卤代烃气体来自工业制冷剂和发泡剂，不仅加剧温室效应，还破坏臭氧层。',
      'IPCC多次发布评估报告明确指出：人类活动导致大气、海洋和陆地变暖已是毋庸置疑的事实。过去100年间全球平均气温约上升了0.74℃。进入21世纪后，高温记录不断被打破——2003年瑞士格罗诺镇录得41.5℃，2006年重庆达43℃，北极变暖速度更是全球平均的数倍。在高排放情景下，到本世纪末全球地表平均温度可能较工业化前升高3.3至5.7℃——这个数字足以让地球成为完全不同的世界。',
      '全球变暖带来的危害是全方位的。冰川加速消融——北极冰层厚度在过去40年减少了约40%，格陵兰岛冰川流失速度在最近五年加快了一倍。海平面上升威胁着马尔代夫等低海拔岛国的生存以及上海、天津等沿海城市的安全。极端天气频发——超级台风、洪涝、干旱、森林火灾的强度和频率不断增加。生态系统遭受冲击——南极阿德利企鹅因冰层融化数量锐减，珊瑚礁因海水升温大规模白化。',
      '应对气候变化需要减缓和适应两手抓。减缓的核心是减少温室气体排放——1992年联合国通过了《气候变化框架公约》，此后《京都议定书》和《巴黎协定》相继签署。具体措施包括发展可再生能源、提高能效、保护森林以增加碳汇。适应方面则需增强应对气候变化的韧性——建设防洪设施、培育耐旱作物、完善预警系统。对普通人而言，低碳生活同样重要：随手关灯、绿色出行、减少一次性制品、垃圾分类、节约粮食——这些微小的举动汇聚起来，就是保护地球的力量。',
    ],
    en:[
      "Over recent decades, Earth's climate has undergone dramatic change. Global temperatures continue to rise, extreme weather events grow more frequent, glaciers melt at accelerating rates, and sea levels keep climbing — all pointing to one fact: our planet is running a fever. In 2020, global average temperatures were about 1.2°C above pre-industrial levels, making it one of the warmest years on record. The root cause is closely tied to greenhouse gas emissions from human activities.",
      "To understand global warming, we must first understand the 'greenhouse effect.' Solar radiation passes through the atmosphere as visible light and reaches Earth's surface. The warmed surface then radiates heat outward as infrared radiation. However, atmospheric gases like carbon dioxide and methane strongly absorb infrared radiation — like the glass of a greenhouse, they trap heat from escaping into space. Without any greenhouse effect, Earth's average surface temperature would be -18°C, not the pleasant 15°C we enjoy. But since the Industrial Revolution, human activities have dramatically increased greenhouse gas concentrations, intensifying the effect and causing persistent warming.",
      "There are four main types of greenhouse gases: carbon dioxide, methane, nitrous oxide, and halogenated gases. Before industrialization, atmospheric CO2 levels held steady at about 280ppm for thousands of years; by 2022, they had surged to 418ppm — primarily from burning coal, oil, and natural gas, plus deforestation. Methane's warming effect is 20-60 times stronger than CO2, mainly from landfills, rice paddies, livestock digestion, and natural gas leaks. Nitrous oxide comes from agricultural soils and fertilizer use. Halogenated gases from industrial refrigerants and foaming agents not only intensify the greenhouse effect but also destroy the ozone layer.",
      "The IPCC has stated unequivocally in multiple assessment reports: human activities have warmed the atmosphere, ocean, and land. Global average temperatures have risen about 0.74°C over the past 100 years. In the 21st century, temperature records have been repeatedly broken — Switzerland recorded 41.5°C in 2003, Chongqing hit 43°C in 2006, and the Arctic is warming several times faster than the global average. Under high-emission scenarios, global surface temperatures could rise 3.3-5.7°C above pre-industrial levels by the end of this century — enough to make Earth a fundamentally different world.",
      "The consequences of global warming are comprehensive. Glaciers are melting at accelerating rates — Arctic ice thickness has decreased by about 40% over the past 40 years, and Greenland's ice loss rate has doubled in the last five years. Sea level rise threatens the very existence of low-lying island nations like the Maldives and endangers coastal cities. Extreme weather events — super typhoons, floods, droughts, wildfires — are increasing in both intensity and frequency. Ecosystems are under severe stress: Adélie penguin populations in Antarctica are collapsing as ice melts, and coral reefs are bleaching on a massive scale due to warming oceans.",
      "Addressing climate change requires both mitigation and adaptation. Mitigation focuses on reducing greenhouse gas emissions — the UN adopted the Framework Convention on Climate Change in 1992, followed by the Kyoto Protocol and Paris Agreement. Key measures include developing renewable energy, improving energy efficiency, and protecting forests to increase carbon sinks. Adaptation means building resilience — constructing flood defenses, breeding drought-resistant crops, and strengthening early warning systems. For ordinary people, low-carbon living matters too: turning off unused lights, choosing green transportation, reducing single-use items, sorting waste, and reducing food waste. These seemingly small actions, when combined, are powerful forces for protecting our planet.",
    ],
  },
};

// ============================================================
// 3. 认证
// ============================================================
let authMode='login';
function renderNav(){
  const n=document.getElementById('nav');
  if(session){
    n.innerHTML='<span style="font-size:0.82em;cursor:pointer" id="profLink">👤 <strong>'+escapeHtml(profile?.username||session.user.email)+'</strong></span> '
      +'<button class="btn sm" id="uploadBtn2">📤 上传</button> '
      +'<button class="btn sm" id="logoutBtn">退出</button> '
      +'<button class="btn sm" id="themeBtn1">🌓</button>';
    document.getElementById('profLink').onclick=openProf;
    document.getElementById('uploadBtn2').onclick=openUp;
    document.getElementById('logoutBtn').onclick=doLogout;
    document.getElementById('themeBtn1').onclick=toggleTheme;
  }else{
    n.innerHTML='<button class="btn a sm" id="loginBtn">👤 登录</button> '
      +'<button class="btn sm" id="regBtn">📝 注册</button> '
      +'<button class="btn sm" id="themeBtn2">🌓</button>';
    document.getElementById('loginBtn').onclick=function(){openAuth('login');};
    document.getElementById('regBtn').onclick=function(){openAuth('register');};
    document.getElementById('themeBtn2').onclick=toggleTheme;
  }
}
function openAuth(mode){
  authMode=mode;
  document.getElementById('authTitle').textContent=mode==='login'?'👤 登录':'📝 注册';
  document.getElementById('authSub').textContent=mode==='login'?'登录以同步翻译贡献':'注册成为语桥社区成员';
  document.getElementById('authBtn').textContent=mode==='login'?'登录':'注册';
  document.getElementById('authToggle').textContent=mode==='login'?'没有账号？去注册':'已有账号？去登录';
  document.getElementById('authName').style.display=mode==='login'?'none':'block';
  document.getElementById('authModal').classList.add('on');
}
function toggleAuth(){closeAuth();openAuth(authMode==='login'?'register':'login');}
function closeAuth(){document.getElementById('authModal').classList.remove('on');}
async function doAuth(){
  if(!requireDB()) return;
  const email=document.getElementById('authEmail').value.trim();
  const pass=document.getElementById('authPass').value;
  const name=document.getElementById('authName').value.trim();
  if(!email||!pass){alert('请填写邮箱和密码');return;}
  if(pass.length<6){alert('密码至少6位');return;}
  const btn=document.getElementById('authBtn');btn.disabled=true;btn.textContent='⏳ 处理中...';
  let r;
  try{
    if(authMode==='login'){
      r=await db.auth.signInWithPassword({email,password:pass});
      btn.disabled=false;btn.textContent='登录';
      if(r.error){alert('登录失败：'+r.error.message);return;}
      session=r.data.session;
      closeAuth();await loadProfile();renderNav();renderLib();
    }else{
      if(!name){btn.disabled=false;btn.textContent='注册';alert('请填写用户名');return;}
      r=await db.auth.signUp({email,password:pass,options:{data:{username:name}}});
      btn.disabled=false;btn.textContent='注册';
      if(r.error){alert('注册失败：'+r.error.message);return;}
      if(r.data.user){try{await db.from('profiles').insert({id:r.data.user.id,username:name});}catch(e){}}
      if(r.data.session){
        session=r.data.session;closeAuth();await loadProfile();renderNav();renderLib();
        alert('注册成功！欢迎 '+name+'！');
      }else{
        closeAuth();alert('注册成功！现在请切换到登录界面\n用刚才的邮箱和密码登录。');
      }
    }
  }catch(e){btn.disabled=false;btn.textContent=authMode==='login'?'登录':'注册';alert('操作失败：'+e.message);}
}
async function doLogout(){if(db)await db.auth.signOut();session=null;profile=null;renderNav();renderLib();}
async function loadProfile(){
  if(!session||!db)return;
  const{data}=await db.from('profiles').select('*').eq('id',session.user.id).single();
  profile=data;
}

// ========== 个人主页 ==========
async function openProf(){
  if(!session||!db)return;
  document.getElementById('profName').textContent='👤 '+(profile?.username||session.user.email);
  document.getElementById('profBio').textContent=profile?.bio||'这个人很懒，什么都没写';
  document.getElementById('profContribs').textContent=profile?.contributions||0;

  // 统计评论数
  let commentCount=0;
  try{const{count}=await db.from('comments').select('*',{count:'exact',head:true}).eq('author_id',session.user.id);commentCount=count||0;}catch(e){}
  document.getElementById('profComments').textContent=commentCount;

  // 统计参与书籍
  let bookSet=new Set();
  try{
    const{data:tData}=await db.from('translations').select('book_id').eq('author_id',session.user.id);
    if(tData) tData.forEach(t=>bookSet.add(t.book_id));
    const{data:cData}=await db.from('comments').select('book_id').eq('author_id',session.user.id);
    if(cData) cData.forEach(c=>bookSet.add(c.book_id));
  }catch(e){}
  document.getElementById('profBooks').textContent=bookSet.size;

  // 最近贡献
  try{
    const{data:recent}=await db.from('translations').select('book_id,paragraph_index,content,created_at').eq('author_id',session.user.id).order('created_at',{ascending:false}).limit(5);
    if(recent&&recent.length>0){
      document.getElementById('profActivity').innerHTML=recent.map(r=>{
        const book=PRELOAD[r.book_id];const bname=book?book.title:r.book_id;
        const d=new Date(r.created_at);
        return'<div style="margin-bottom:4px;padding:4px 6px;background:var(--hl);border-radius:6px">📖 <strong>'+escapeHtml(bname)+'</strong> §'+(r.paragraph_index+1)+' · '+escapeHtml(r.content.substring(0,80))+'... <span style="font-size:0.8em">'+d.toLocaleString('zh-CN')+'</span></div>';
      }).join('');
    }else{
      document.getElementById('profActivity').textContent='暂无贡献记录。去改进一段翻译吧！';
    }
  }catch(e){document.getElementById('profActivity').textContent='加载失败';}
  document.getElementById('profM').classList.add('on');
}
function closeProf(){document.getElementById('profM').classList.remove('on');}

// ========== 逐段翻译 ==========
async function translatePara(i){
  if(!session||!db){alert('请先登录');return;}
  const zh=curBook.zh[i];if(!zh)return;
  // 标记按钮状态
  const btns=document.querySelectorAll('#rightC button');
  let btn=null;
  btns.forEach(b=>{if(b.textContent.includes('翻译此段')&&b.closest('.para')?.getAttribute('data-i')==String(i))btn=b;});
  if(btn){btn.disabled=true;btn.textContent='⏳ 翻译中...';}
  try{
    let trans='';
    try{
      const r=await fetch('https://lingva.ml/api/v1/zh/en/'+encodeURIComponent(zh),{signal:AbortSignal.timeout(15000)});
      const d=await r.json();if(d.translation)trans=d.translation;
    }catch(e){}
    if(!trans){
      try{
        const r=await fetch('https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh-CN&tl=en&dt=t&q='+encodeURIComponent(zh.substring(0,500)),{signal:AbortSignal.timeout(10000)});
        const d=await r.json();if(d&&d[0])trans=d[0].map(x=>x[0]).join('');
      }catch(e){}
    }
    if(!trans){if(btn){btn.disabled=false;btn.textContent='🌐 翻译此段';}alert('翻译失败，请稍后重试');return;}
    // 通过 Edge Function API 保存（绕过速率限制：AI翻译标记为 author_name='AI'）
    const resp=await fetch(API_BASE+'/upload-translation',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token},
      body:JSON.stringify({book_id:curBook.id,paragraph_index:i,language:curLang,content:trans})
    });
    if(!resp.ok){const r=await resp.json();throw new Error(r.error);}
    await loadCloudVersions();renderR();showReport();
  }catch(e){alert('翻译失败：'+e.message);if(btn){btn.disabled=false;btn.textContent='🌐 翻译此段';}}
}

// ========== TXT 标准化引擎 ==========
function normalizeText(text){
  // 1. 统一换行符
  text=text.replace(/\r\n/g,'\n').replace(/\r/g,'\n');
  // 2. 清理常见噪音
  text=text.replace(/第[【\[\(（]\s*\d+\s*[】\]\)）][段节]/g,'');          // 第【1】段
  text=text.replace(/^[\(（]\d+[\)）]\s*/gm,'');                        // (1) 序号
  text=text.replace(/^\d{1,4}\s*$/gm,'');                               // 纯页码行
  text=text.replace(/^[\/\*\-—]{3,}\s*$/gm,'');                         // 分隔线
  // 3. 检测段落分隔方式，统一为双换行
  const fullSpaceCount=(text.match(/　　/g)||[]).length;
  const mixedSpaceCount=(text.match(/[　 　]{2,}/g)||[]).length;
  if(fullSpaceCount>5||mixedSpaceCount>10){
    // 空格缩进分段 → 转为双换行
    text=text.replace(/[　 　]{2,}/g,'\n\n');
  }
  // 4. 单换行变双换行（保守：仅在无明显双换行时）
  const doubleNewlines=(text.match(/\n\n/g)||[]).length;
  if(doubleNewlines<5&&text.length>5000){
    text=text.replace(/\n(?!\n)/g,'\n\n');
  }
  // 5. 压缩多余空行：3+ → 2
  text=text.replace(/\n{3,}/g,'\n\n');
  // 6. 每行去首尾空白
  text=text.split('\n').map(l=>l.trim()).join('\n');
  // 7. 注释标记独立成段：①②③等后接文字 → 与上文分开
  text=text.replace(/([^\n])([①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳]+\s*\S)/g,'$1\n\n$2');
  // 8. 去首尾空行
  text=text.replace(/^\n+/,'').replace(/\n+$/,'');
  return text;
}

// 智能分段：在标准化后的文本上工作
function smartSplit(text){
  // 先标准化
  text=normalizeText(text);
  // 清理格式标记和页码
  text=text.replace(/第[【\[]\d+[】\]][段节]/g,'').replace(/^[\(（]\d+[\)）]\s*/gm,'');
  text=text.replace(/^\d{1,4}\s*$/gm,'');
  // 统一换行符
  text=text.replace(/\r\n/g,'\n').replace(/\r/g,'\n');

  let paras=[];

  // 策略1：双换行分段
  paras=text.split(/\n\s*\n/).filter(p=>p.trim());

  // 策略2：中文段落缩进分段（两个以上连续空格/全角空格 = 新段落）
  if(paras.length<10&&text.length>2000){
    // 匹配 2+个空格或全角空格的组合（中国出版格式：段首缩进）
    const indentCount=(text.match(/[　 　]{2,}/g)||[]).length;
    if(indentCount>3){
      paras=text.split(/[　 　]{2,}/).filter(p=>p.trim());
      // 清理行内残留空格
      paras=paras.map(p=>p.replace(/[　 　]+/g,'').trim()).filter(p=>p.length>0);
      // 第一段拆题记+章节标题（如果有换行）
      if(paras.length>0&&paras[0].includes('\n')){
        const frontParts=paras[0].split(/\n+/).filter(p=>p.trim());
        if(frontParts.length>1){paras.shift();paras=frontParts.concat(paras);}
      }
    }
  }

  // 策略3：单换行分段（每一行可能是独立段落）
  if(paras.length<10&&text.length>2000){
    const lines=text.split(/\n/).filter(l=>l.trim());
    const merged=[];let buf='';
    for(const l of lines){
      if(l.length<20&&buf){buf+='\n'+l;}
      else{if(buf.trim())merged.push(buf.trim());buf=l;}
    }
    if(buf.trim())merged.push(buf.trim());
    if(merged.length>paras.length)paras=merged;
  }

  // 策略4：句号强制分段（兜底）
  if(paras.length<5&&text.length>2000){
    const clean=text.replace(/\n/g,'').replace(/　/g,'');
    const sentences=clean.split(/(?<=[。！？\.\!\?])/);
    const merged=[];let buf='';
    for(const s of sentences){
      if(buf.length+s.length>800){merged.push(buf.trim());buf=s;}
      else{buf+=s;}
    }
    if(buf.trim())merged.push(buf.trim());
    if(merged.length>paras.length)paras=merged;
  }

  // 最后一步：段落内部如存在2格以上连续空格 → 强制在此处分段
  const final=[];
  for(const p of paras){
    if(p.length>200&&/[　 　]{2,}/.test(p)){
      const subParts=p.split(/[　 　]{2,}/).filter(s=>s.trim());
      final.push(...subParts.map(s=>s.replace(/[　 　]+/g,'').trim()).filter(s=>s.length>0));
    }else{final.push(p);}
  }
  return final.filter(p=>p.length>0);
}

// ========== 上传新书 ==========
function openUp(){
  if(!session){alert('请先登录');return;}
  document.getElementById('upM').classList.add('on');
}
function closeUp(){document.getElementById('upM').classList.remove('on');}
let uploading=false;
async function doUp(btn){
  if(uploading)return;
  const title=document.getElementById('upTitle').value.trim();
  const author=document.getElementById('upAuthor').value.trim()||'佚名';
  const genre=document.getElementById('upGenre').value;
  const file=document.getElementById('upFile').files[0];
  if(!title){alert('请输入书名');return;}
  if(!file){alert('请选择文件');return;}

  uploading=true;
  if(btn){btn.disabled=true;btn.textContent='⏳ 读取文件中...';}
  try{
    const text=await new Promise((ok,fail)=>{
      const r=new FileReader();r.onload=e=>ok(e.target.result);r.onerror=()=>fail(new Error('读取失败'));r.readAsText(file,'UTF-8');
    });
    if(!text||text.trim().length<20){alert('文件内容过短');uploading=false;if(btn){btn.disabled=false;btn.textContent='📤 上传';}return;}

    if(btn)btn.textContent='⏳ 分段处理中...';
    const bookId='u-'+Date.now()+'-'+Math.random().toString(36).substring(2,6);
    const paras=smartSplit(text);
    if(paras.length===0){alert('未能识别段落');uploading=false;if(btn){btn.disabled=false;btn.textContent='📤 上传';}return;}

    // 不再存localStorage（避免quota超限），Supabase是可靠数据源
    if(db){
      if(btn)btn.textContent='⏳ 存入云端...';
      await db.from('books').insert({id:bookId,title,author,genre,cover:'📖',description:text.substring(0,5000),word_count:text.length,uploader_id:session.user.id});
      for(let i=0;i<paras.length;i+=100){
        if(btn)btn.textContent='⏳ '+(Math.min(i+100,paras.length))+'/'+paras.length+' 段...';
        const batch=paras.slice(i,i+100).map((p,j)=>({book_id:bookId,paragraph_index:i+j,language:'zh',version:1,author_name:'AI',content:p}));
        const{error:insErr}=await db.from('translations').insert(batch);
        if(insErr){console.warn('Batch '+i+' insert error:',insErr);throw new Error('写入失败：'+insErr.message);}
      }
      // 验证写入：从数据库读回确认
      if(btn)btn.textContent='⏳ 验证数据...';
      await new Promise(r=>setTimeout(r,1000));
      const{data:check}=await db.from('translations').select('paragraph_index').eq('book_id',bookId).eq('language','zh').limit(3);
      if(!check||check.length===0){
        throw new Error('数据验证失败：写入后无法读回。请检查网络后重试。');
      }
    }

    PRELOAD[bookId]={title,author,genre,cover:'📖',desc:'用户上传 · 等待社区翻译',wordCount:text.length,zh:paras,en:paras.map(()=>'')};
    if(btn){btn.textContent='✅ 上传完成';}
    setTimeout(()=>{closeUp();renderLib();},600);
    alert('✅ 上传成功！'+paras.length+'段，已加入资料库。\n点击段落旁的"🌐翻译"按钮逐段翻译，或等待社区成员贡献。');
  }catch(e){alert('上传失败：'+e.message);}
  uploading=false;
  if(btn){btn.disabled=false;btn.textContent='📤 上传';}
}

// ============================================================
// 4. 资料库
// ============================================================
let filterTag='all';
async function renderLib(){
  let books=Object.entries(PRELOAD).map(([id,b])=>({id,...b}));
  
  // 检测数据库在线状态
  if(db){
    const online = await checkDBOnline();
    if(online){
      hideOfflineBanner();
      // 从Supabase加载用户上传的书籍
      try{
        const{data}=await db.from('books').select('*');
        if(data) data.forEach(b=>{if(!PRELOAD[b.id]) books.push({id:b.id,title:b.title,author:b.author,genre:b.genre,cover:b.cover||'📖',desc:b.description||'',wordCount:b.word_count||0,isUploaded:true,uploaderId:b.uploader_id});});
      }catch(e){console.warn('Load books failed:',e.message);dbOnline=false;updateDBStatus('offline');}
    }else{
      showOfflineBanner();
    }
  }else{
    updateDBStatus('offline');
    showOfflineBanner();
  }
  if(filterTag!=='all') books=books.filter(b=>b.genre===filterTag);
  document.getElementById('bookGrid').innerHTML=books.map(b=>{
    return'<div class="book-card" onclick="openB(\''+b.id+'\')">'
      +'<div class="cover">'+b.cover+'</div>'
      +'<div class="title">'+b.title+'</div>'
      +'<div class="author">'+b.author+'</div>'
      +'<span class="genre">'+b.genre+'</span>'
      +'<div class="meta"><span>📄 '+(b.wordCount||0)+'字</span>'+(b.isUploaded?'<span style="font-size:0.75em;color:var(--s)"> · 📤 用户上传</span>':'')+'</div>'
      +'</div>';
  }).join('');
}
function filter(g,el){filterTag=g;document.querySelectorAll('.lib-tags span').forEach(t=>t.classList.remove('on'));el.classList.add('on');renderLib();}
function goLib(){
  curBook=null;
  document.getElementById('libPage').style.display='block';
  document.getElementById('readerPage').classList.remove('on');
  document.getElementById('tocPanel').style.display='none';
  history.pushState({view:'library'},'','#');
  renderLib();
}

// ============================================================
// 5. 阅读器
// ============================================================
let curBook=null,curLang='en',editIdx=null,commVersions={},commComments={},realtimeChannel=null,curChapter=0;

async function openB(id){
  let book=PRELOAD[id];
  if(!book){
    // 非预置书需要数据库，先检查在线状态
    if(!db||!dbOnline){
      alert('📚 此书籍数据存储在云端，数据库当前离线。\n\n预置的6本书籍（小王子、边城、斗破苍穹、全职高手等）仍可正常阅读。\n\n请等待数据库恢复后重试。');
      return;
    }
    if(db){try{
      const{data:bData}=await db.from('books').select('*').eq('id',id).single();
      if(bData){
        // 分页加载全部段落（Supabase默认limit 1000，需分批）
        const totalCount=bData.word_count>100000?Math.ceil(bData.word_count/200):500;
        const allParas=[];let hasMore=true,offset=0;
        while(hasMore){
          const{data:tData}=await db.from('translations').select('content,paragraph_index').eq('book_id',id).eq('language','zh').order('paragraph_index',{ascending:true}).range(offset,offset+999);
          if(tData&&tData.length>0){tData.forEach(t=>{allParas[t.paragraph_index]=t.content;});offset+=1000;}
          if(!tData||tData.length<1000)hasMore=false;
        }
        const zh=allParas.filter(p=>p&&p.trim());
        if(zh.length>0){
          book={title:bData.title,author:bData.author,genre:bData.genre,cover:bData.cover||'📖',desc:bData.description||'',wordCount:bData.word_count||0,zh,en:zh.map(()=>''),isUploaded:true,uploaderId:bData.uploader_id};
          PRELOAD[id]=book;try{localStorage.setItem('rb_raw_'+id,zh.join('\n\n'));}catch(e){}
        }
      }
    }catch(e){console.warn('Supabase加载失败:',e.message);}}
    if(!book){const raw=localStorage.getItem('rb_raw_'+id);if(raw){try{const zh=smartSplit(raw);if(zh.length>0){book={zh,en:zh.map(()=>''),isUploaded:true};PRELOAD[id]=book;}}catch(e){localStorage.removeItem('rb_raw_'+id);}}}
  }
  if(!book){alert('书籍未找到。');return;}
  if(!book.zh||book.zh.length===0){alert('书籍内容为空。');return;}
  curBook=book;curBook.id=id;curChapter=0;
  try{userActive=JSON.parse(localStorage.getItem('rb_active_'+id)||'{}');}catch(e){userActive={};}
  document.getElementById('libPage').style.display='none';
  document.getElementById('readerPage').classList.add('on');
  document.getElementById('rbTitle').textContent=curBook.title+' · '+curBook.author;
  document.getElementById('tlLbl').textContent={en:'English',ja:'日本語',ko:'한국어',fr:'Français'}[curLang]||'English';

  // 构建目录
  buildTOC();

  commVersions={};commComments={};
  await loadCloudVersions();
  await loadComments();
  subscribeRealtime();

  renderL();renderR();updateWC();syncScroll();
  setTimeout(loadVoteCounts,500);
  // 按钮显隐
  const delBtn=document.getElementById('delBookBtn');
  const dlBtn=document.getElementById('dlBookBtn');
  const utBtn=document.getElementById('upTransBtn');
  if(curBook.isUploaded){
    delBtn.style.display='inline-flex';
    dlBtn.style.display='inline-flex';
    utBtn.style.display=session?'inline-flex':'none';
  }else{
    delBtn.style.display='none';
    dlBtn.style.display='none';
    utBtn.style.display='none';
  }
  // 浏览器返回键支持
  history.pushState({view:'reader',bookId:id},'', '#book='+id);
}

// 目录构建
let gChapters=[];
let tocTree=[];

function buildTOC(){
  const toc=document.getElementById('tocList');if(!toc)return;
  const zh=curBook.zh;if(!zh||zh.length<3){gChapters=[];toc.innerHTML='';document.getElementById('chapNav').style.display='none';return;}
  gChapters=[];

  // 找出所有候选章节（先收集再过滤）
  const SKIP=/^(注释|注解|注|译者序|作者序|前言|序言|后记|跋|附录|参考文献|出版信息|版权|ISBN|定价|印次|版次|印刷|书号|策划|责编|编辑|设计|排版|出品|荣誉|推荐语|楔子|引子|尾声|番外)/;
  const SPECIAL=/^(引言|题记|楔子|尾声|番外|序章|终章|跋|代序|小引|后记|自序)/;
  const candidates=[];
  // 题记/引言等特殊标题检测：位于第一章之前 + 第一行含关键词 + 首行≤15字
  let firstRealChap=-1;
  for(let i=0;i<Math.min(50,zh.length);i++){
    if(/第[一二三四五六七八九十百千\d]+[章节回]/.test(zh[i])||/chapter\s*\d+/i.test(zh[i])){firstRealChap=i;break;}
  }
  const searchEnd=firstRealChap>0?firstRealChap:Math.min(20,zh.length);
  for(let i=0;i<searchEnd;i++){
    const p=zh[i];if(!p)continue;
    const firstLine=p.split('\n')[0].trim(); // 只检查第一行
    if(firstLine.length>15)continue;
    if(firstLine.includes('题记')||firstLine.includes('引言')||firstLine.includes('楔子')||firstLine.includes('序章')||firstLine.includes('前言')||firstLine.includes('代序')||firstLine.includes('跋')||firstLine.includes('小引')||firstLine.includes('后记')||firstLine.includes('自序')){
      candidates.push({title:firstLine,index:i});break;
    }
  }
  zh.forEach((p,i)=>{
    let title='';
    // 规则1：第X章/节/回
    const m1=p.match(/第[一二三四五六七八九十百千\d]+[章节回]/);
    if(m1){
      const rest=p.substring(m1.index+m1[0].length).trim().replace(/^[　\s]+/,'');
      if(!SKIP.test(rest)&&rest.length<80)title=m1[0]+(rest?' '+rest.substring(0,18):'');
      else if(!rest||rest.length<3)title=m1[0];
    }
    // 规则2：英文Chapter
    if(!title){const m2=p.match(/Chapter\s*\d+|CHAPTER\s*[IVX]+/i);if(m2)title=p.substring(m2.index,Math.min(m2.index+30,p.length)).trim();}
    // 规则3：纯中文数字作章节（边城类）— "一"、"二" 且单独成段
    if(!title&&p.length<10&&/^[一二三四五六七八九十百千]{1,3}$/.test(p.trim()))title='第'+p.trim()+'章';
    // 规则3b：中文数字+点+标题（朝花夕拾/呐喊类）— "一.狗 猫 鼠"、"八.阿Q正传"
    const m3b=p.match(/^[一二三四五六七八九十百千]{1,3}[\.\、\s]\s*(.+)/);
    if(!title&&m3b)title=m3b[0].length>30?m3b[0].substring(0,30)+'...':m3b[0];
    // 规则4：纯数字章节
    if(!title&&p.length<20&&/^\d+$/.test(p)&&i>0)title='第'+p+'章';
    // 规则5：数字+标点
    if(!title){const m4=p.match(/^(\d{1,3})[\.\、\)）]\s*\S/);if(m4&&p.length<100)title=m4[0];}
    // 规则6：短段标题(仅预置书)
    if(!title&&!curBook.isUploaded&&p.length<40&&p.length>3&&!/[，。！？,\.!\?：:；;]/.test(p)&&!SKIP.test(p))title=p.trim();
    if(title)candidates.push({title,index:i});
  });

  // 给每个候选标注类型（用于双重编号检测）
  candidates.forEach(c=>{
    const orig=zh[c.index]||'';
    if(/第[一二三四五六七八九十百千\d]+[章节回]/.test(orig))c._type='cn';
    else if(/^[一二三四五六七八九十百千]{1,3}$/.test(orig.trim()))c._type='num';
  });

  // 区分假目录 vs 真章节：按间隙聚类
  // 找出所有"大间隙"（≥5段）的位置
  let firstLargeGap=-1;
  for(let i=1;i<candidates.length;i++){
    if(candidates[i].index-candidates[i-1].index>=5){firstLargeGap=i;break;}
  }
  // 如果第一个大间隙之前只有≤3个候选 → 那些是真的前言/题记/第一章，保留
  // 如果第一个大间隙之前有>5个候选且都间隙<5 → 那是TOC集群，丢弃
  let realStart=0;
  if(firstLargeGap>0){
    if(firstLargeGap<=3) realStart=0; // 前言+前几章，保留全部
    else realStart=firstLargeGap; // TOC集群在前面，跳过
  }
  // 如果没有大间隙但候选过多 → 降级：只保留"第X章"格式
  if(realStart===0&&candidates.length>50){
    let maxGap=0,maxIdx=0;
    for(let i=1;i<candidates.length;i++){const gap=candidates[i].index-candidates[i-1].index;if(gap>maxGap){maxGap=gap;maxIdx=i;}}
    if(maxGap>=3&&maxIdx>10)realStart=maxIdx;
  }

  // 只保留真章节
  gChapters=candidates.slice(realStart);

  // 特殊章节豁免：题记/引言/番外等如通过正文长度验证 → 始终保留
  const specialChapters=candidates.filter(c=>{
    if(!SPECIAL.test(c.title))return false;
    const ci=candidates.indexOf(c);
    const nextIdx=(ci+1<candidates.length)?candidates[ci+1].index:zh.length;
    let len=0;
    // 同一段落内标题之后的文字
    const firstPara=zh[c.index]||'';
    const titlePos=firstPara.indexOf(c.title);
    if(titlePos>=0)len+=firstPara.substring(titlePos+c.title.length).length;
    for(let j=c.index+1;j<nextIdx;j++){if(zh[j])len+=zh[j].length;}
    return len>=150;
  });
  // 将符合条件的特殊章节插入到gChapters最前面（如果不在里面）
  const existingTitles=new Set(gChapters.map(c=>c.title));
  for(const sc of specialChapters){
    if(!existingTitles.has(sc.title))gChapters.unshift(sc);
  }

  // 双重章节名优先级
  const chapA=gChapters.filter(c=>c._type==='cn');
  const chapB=gChapters.filter(c=>c._type==='num');
  if(chapA.length>=2&&chapB.length>=2){
    if(chapB[0].index>chapA[0].index) gChapters=gChapters.filter(c=>c._type!=='cn');
    else if(chapA[0].index>chapB[0].index) gChapters=gChapters.filter(c=>c._type!=='num');
  }

  // === 三重新验证 ===

  // 子章节检测（在验证1之前）：连续≥3个小间隙 + 格式不同 → 归为副标题
  let subGroups=[];
  const subIdxSet=new Set();
  for(let i=0;i<gChapters.length;i++){
    if(SPECIAL.test(gChapters[i].title))continue;
    const mainFormat=/^[一二三四五六七八九十百千]{1,3}[\.\、\s]/.test(gChapters[i].title)?'dot':
                    /第[一二三四五六七八九十百千\d]+[章节回]/.test(gChapters[i].title)?'numbered':'other';
    const sub=[];let j=i+1;
    // 第一个子候选无条件纳入（主章节到子章节间隙可能大）
    if(j<gChapters.length){sub.push(gChapters[j]);j++;}
    // 后续子章节之间间隙≤3
    while(j<gChapters.length&&gChapters[j].index-gChapters[j-1].index<=3){sub.push(gChapters[j]);j++;}
    const subFormat=sub.length>0?(/第[一二三四五六七八九十百千\d]+[章节回]/.test(sub[0].title)?'numbered':'other'):'none';
    if(sub.length>=3&&subFormat!==mainFormat&&subFormat!=='none'){
      subGroups.push({mainIdx:i,subs:sub});i=j-1;
      sub.forEach(s=>subIdxSet.add(gChapters.indexOf(s)));
    }
  }

  // === 章节目录校验（只筛假，不杀真）===

  // 规则1：中英分离 + 子格式冲突
  let cnNumbered=[],cnDot=[],enChap=[];
  if(gChapters.length>=3){
    const mainOnly=gChapters.filter((c,i)=>!subIdxSet.has(i));
    cnNumbered=mainOnly.filter(c=>/第[一二三四五六七八九十百千\d]+[章节回]/.test(c.title));
    cnDot=mainOnly.filter(c=>/^[一二三四五六七八九十百千]{1,3}[\.\、\s]/.test(c.title));
    enChap=mainOnly.filter(c=>/chapter/i.test(c.title));
    const total=mainOnly.length;
    const cnAll=cnNumbered.length+cnDot.length;
    // 中文章节占主导(>80%) → 过滤英文
    if(cnAll>total*0.8){
      gChapters=gChapters.filter(c=>SPECIAL.test(c.title)||cnNumbered.includes(c)||cnDot.includes(c));
      // 子格式冲突仅在极度倾斜时触发(>90%)
      if(cnDot.length>cnAll*0.9) gChapters=gChapters.filter(c=>SPECIAL.test(c.title)||cnDot.includes(c));
      else if(cnNumbered.length>cnAll*0.9) gChapters=gChapters.filter(c=>SPECIAL.test(c.title)||cnNumbered.includes(c));
    }else if(enChap.length>total*0.8){
      gChapters=gChapters.filter(c=>SPECIAL.test(c.title)||enChap.includes(c));
    }
  }

  // 规则2：数字序列从1递增 — 仅在单格式统一 + 开头不是1时纠正
  const cnAll2=cnNumbered.length+cnDot.length;
  const formatUnified=(cnDot.length>cnAll2*0.9)||(cnNumbered.length>cnAll2*0.9);
  const cnMap={'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10};
  function parseCN(n){
    if(/^\d+$/.test(n))return parseInt(n);
    if(n.length===1)return cnMap[n]||-1;
    if(n==='十')return 10;
    if(n.startsWith('十'))return 10+(cnMap[n[1]]||0);
    if(n.endsWith('十'))return (cnMap[n[0]]||0)*10;
    const parts=n.split('十');return(cnMap[parts[0]]||0)*10+(cnMap[parts[1]]||0);
  }
  function getChapterNumber(c){
    const m1=c.title.match(/第([一二三四五六七八九十百千\d]+)[章节回]/);
    if(m1)return parseCN(m1[1]);
    const m2=c.title.match(/^[一二三四五六七八九十百千]{1,3}(?=[\.\、\s])/);
    if(m2)return parseCN(m2[0]);
    return-1;
  }
  const nonSpecial=gChapters.filter(c=>!SPECIAL.test(c.title));
  if(nonSpecial.length>=5&&formatUnified){
    const nums=nonSpecial.map(c=>getChapterNumber(c)).filter(n=>n>0);
    let fromOne=[];let cur=1;
    for(const n of nums){if(n===cur){fromOne.push(n);cur++;}else if(n>cur)break;}
    if(fromOne.length>=5&&nums[0]!==1){
      const keepNums=new Set(fromOne);
      gChapters=gChapters.filter(c=>{
        if(SPECIAL.test(c.title))return true;
        const n=getChapterNumber(c);
        return n>0?keepNums.has(n):false;
      });
    }
  }

  // 规则3：数字格式排它 — 仅在双格式同时≥3个且明显冲突时触发
  if(gChapters.length>=6){
    const arabic=gChapters.filter(c=>/第\d+[章节回]/.test(c.title));
    const chinese=gChapters.filter(c=>/第[一二三四五六七八九十百千]+[章节回]/.test(c.title));
    if(arabic.length>=3&&chinese.length>=3){
      let firstAr=-1,firstCn=-1;
      for(let i=0;i<gChapters.length;i++){
        const t=gChapters[i].title;
        if(firstAr===-1&&/第\d+[章节回]/.test(t))firstAr=i;
        if(firstCn===-1&&/第[一二三四五六七八九十百千]+[章节回]/.test(t))firstCn=i;
      }
      if(firstCn>=0&&firstAr>=0){
        if(firstCn<firstAr) gChapters=gChapters.filter(c=>!/第\d+[章节回]/.test(c.title));
        else gChapters=gChapters.filter(c=>!/第[一二三四五六七八九十百千]+[章节回]/.test(c.title));
      }
    }
  }

  // 验证2：正文长度 — 真章节≥50字；特殊章≥150字
  gChapters=gChapters.filter((c,i)=>{
    const nextIdx=(i+1<gChapters.length)?gChapters[i+1].index:zh.length;
    let bodyLen=0;
    // 同一段落内标题之后的文字也计入（适用于"题记"标题+正文在同一段的情况）
    const firstPara=zh[c.index]||'';
    const titlePos=firstPara.indexOf(c.title);
    if(titlePos>=0)bodyLen+=firstPara.substring(titlePos+c.title.length).length;
    // 后续段落全部计入
    for(let j=c.index+1;j<nextIdx;j++){if(zh[j])bodyLen+=zh[j].length;}
    if(SPECIAL.test(c.title))return bodyLen>=150;
    return bodyLen>=50;
  });

  // 验证3：注释过滤 — 两个候选间距<2段且第二个更长 → 第一个是注释
  gChapters=gChapters.filter((c,i)=>{
    if(i===0)return true;
    const prev=gChapters[i-1];
    if(c.index-prev.index<=2&&c.title.length>prev.title.length)return false;
    return true;
  });

  // 去重：标题相同的相邻项只保留一个
  gChapters=gChapters.filter((c,i)=>i===0||c.title!==gChapters[i-1].title);

  // 重建tocTree（基于最终gChapters + subGroups）
  tocTree=[];
  const finalSubIdx=new Set();
  subGroups.forEach(g=>g.subs.forEach(s=>finalSubIdx.add(gChapters.indexOf(s))));
  for(let i=0;i<gChapters.length;i++){
    if(finalSubIdx.has(i))continue;
    const entry={chapter:gChapters[i],subs:[]};
    const sg=subGroups.find(g=>g.mainIdx===i);
    if(sg)entry.subs=sg.subs;
    tocTree.push(entry);
  }

  if(gChapters.length>200) gChapters=gChapters.slice(0,200);

  if(gChapters.length===0){toc.innerHTML='<span style="font-size:0.75em;color:var(--s)">未检测到章节标题</span>';document.getElementById('chapNav').style.display='none';return;}
  toc.innerHTML=tocTree.map((entry,idx)=>{
    const c=entry.chapter;
    let html='<div style="padding:5px 8px;cursor:pointer;font-size:0.78em;border-radius:4px;margin-bottom:2px" onclick="scrollToPara('+c.index+')" onmouseover="this.style.background=\'var(--hl)\'" onmouseout="this.style.background=\'transparent\'">';
    html+='<span style="color:var(--s);font-size:0.8em">'+(idx+1)+'.</span> '+escapeHtml(c.title);
    if(entry.subs.length>0){
      html+=' <span style="color:var(--a);cursor:pointer;font-size:0.9em" onclick="event.stopPropagation();toggleSubs('+idx+')" id="tog'+idx+'">▶</span>';
    }
    html+='</div>';
    if(entry.subs.length>0){
      html+='<div id="sub'+idx+'" style="display:none;padding-left:16px">';
      entry.subs.forEach((s,sidx)=>{
        html+='<div style="padding:3px 8px;cursor:pointer;font-size:0.72em;border-radius:4px;margin-bottom:1px" onclick="scrollToPara('+s.index+')" onmouseover="this.style.background=\'var(--hl)\'" onmouseout="this.style.background=\'transparent\'">└ '+escapeHtml(s.title)+'</div>';
      });
      html+='</div>';
    }
    return html;
  }).join('');
  if(gChapters.length>200) toc.innerHTML+='<div style="font-size:0.7em;color:var(--s);padding:4px">... 还有'+(gChapters.length-200)+'条未显示</div>';
  document.getElementById('chapNav').style.display='flex';
  updateChapNav(0);
}

function toggleSubs(idx){
  const sub=document.getElementById('sub'+idx);
  const tog=document.getElementById('tog'+idx);
  if(sub.style.display==='none'){sub.style.display='block';tog.textContent='▼';}
  else{sub.style.display='none';tog.textContent='▶';}
}
function scrollToPara(i){
  // 找到目标段落所属主章节
  for(let c=0;c<tocTree.length;c++){
    const nextStart=(c+1<tocTree.length)?tocTree[c+1].chapter.index:curBook.zh.length;
    if(i>=tocTree[c].chapter.index&&i<nextStart){curChapter=c;break;}
  }
  renderL();renderR();updateWC();syncScroll();updateChapNav(curChapter);
  setTimeout(()=>{
    const target=document.querySelector('#leftC .para[data-i="'+i+'"]')||document.querySelector('#rightC .para[data-i="'+i+'"]');
    if(target)target.scrollIntoView({behavior:'smooth',block:'start'});
  },200);
}

// 上下章导航
function updateChapNav(curIdx){
  document.getElementById('chapPrev').disabled=(curIdx<=0);
  document.getElementById('chapNext').disabled=(curIdx>=tocTree.length-1);
  document.getElementById('chapLabel').textContent=(curIdx+1)+'/'+tocTree.length;
}
function prevChapter(){
  if(curChapter>0){curChapter--;renderL();renderR();updateWC();syncScroll();updateChapNav(curChapter);document.getElementById('leftP').scrollTop=0;}
}
function nextChapter(){
  if(curChapter<tocTree.length-1){curChapter++;renderL();renderR();updateWC();syncScroll();updateChapNav(curChapter);document.getElementById('leftP').scrollTop=0;}
}

async function loadCloudVersions(){
  if(!db||!dbOnline)return;
  try{
    const allVers=[];let hasMore=true,offset=0;
    while(hasMore){
      const{data}=await db.from('translations').select('*').eq('book_id',curBook.id).eq('language',curLang).order('version',{ascending:true}).range(offset,offset+999);
      if(data&&data.length>0){allVers.push(...data);offset+=1000;}
      if(!data||data.length<1000)hasMore=false;
    }
    allVers.forEach(v=>{const k=v.paragraph_index+'-'+curLang;if(!commVersions[k])commVersions[k]=[];commVersions[k].push(v);});
  }catch(e){console.warn('Load versions failed:',e.message);dbOnline=false;updateDBStatus('offline');}
}
async function loadComments(){
  if(!db||!dbOnline)return;
  try{const{data}=await db.from('comments').select('*').eq('book_id',curBook.id).order('created_at',{ascending:true});
  if(data){data.forEach(c=>{const k=c.paragraph_index;if(!commComments[k])commComments[k]=[];commComments[k].push(c);});}}catch(e){console.warn('Load comments failed:',e.message);}
}

function subscribeRealtime(){
  if(!db||!dbOnline)return;
  try{
    if(realtimeChannel)db.removeChannel(realtimeChannel);
    realtimeChannel=db.channel('rb-'+curBook.id)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'translations',filter:'book_id=eq.'+curBook.id},async()=>{
        await loadCloudVersions();renderR();showReport();
      })
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'comments',filter:'book_id=eq.'+curBook.id},async()=>{
        await loadComments();renderR();
      })
      .subscribe();
  }catch(e){console.warn('Realtime subscribe failed:',e.message);}
}

// 用户版本选择偏好（localStorage存储）
let userActive={};

function getActive(pi,lang){
  const k=pi+'-'+lang;
  const cloud=commVersions[k];
  if(cloud&&cloud.length>0){
    // 检查用户是否手动选择了某个版本
    const uk=curBook?.id+'-'+pi+'-'+lang;
    const chosen=userActive[uk];
    if(chosen){const found=cloud.find(v=>v.version===chosen);if(found)return found;}
    // 默认返回最新版本
    return cloud[cloud.length-1];
  }
  const pre=curBook[lang];
  if(pre&&pre[pi]) return {version:1,author_name:'AI',content:pre[pi]};
  return null;
}

function saveUserActive(pi,lang,ver){
  const uk=curBook.id+'-'+pi+'-'+lang;
  userActive[uk]=ver;
  try{localStorage.setItem('rb_active_'+curBook.id,JSON.stringify(userActive));}catch(e){}
}

function getVersions(pi,lang){
  const k=pi+'-'+lang;
  return commVersions[k]||[];
}

// 当前章节的段落范围（基于tocTree）
function chapterRange(){
  if(!tocTree.length) return {start:0,end:curBook.zh.length};
  const entry=tocTree[curChapter];if(!entry)return{start:0,end:curBook.zh.length};
  const start=entry.chapter.index;
  const end=(curChapter+1<tocTree.length)?tocTree[curChapter+1].chapter.index:curBook.zh.length;
  return {start,end};
}

function renderL(){
  const c=document.getElementById('leftC');
  const zh=curBook.zh;if(!zh)return;
  const r=chapterRange();
  c.innerHTML=zh.slice(r.start,r.end).map((t,i)=>{
    const absIdx=r.start+i;
    return'<div class="para" data-i="'+absIdx+'"><span class="n">§ '+(absIdx+1)+'</span>'+escapeHtml(t)+'</div>';
  }).join('');
}

function renderR(){
  const c=document.getElementById('rightC');
  const zh=curBook.zh;if(!zh)return;
  const r=chapterRange();
  c.innerHTML=zh.slice(r.start,r.end).map((_,j)=>{const i=r.start+j;
    const v=getActive(i,curLang);const has=v&&v.content;
    const vs=getVersions(i,curLang);
    const humanVs=vs.filter(x=>x.author_name!=='AI');
    const comments=commComments[i]||[];
    // 协作标记：有改进的段落显示醒目标记
    let collabTag='';
    if(humanVs.length>0) collabTag=' <span style="background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;font-size:0.78em;padding:3px 10px;border-radius:10px;font-weight:700;cursor:pointer;box-shadow:0 2px 8px rgba(37,99,235,0.3);animation:collabPulse 2s ease-in-out infinite" onclick="openVr('+i+')" title="点击查看所有版本">👥 '+humanVs.length+'人改进 · v'+vs.length+'</span>';
    else if(vs.length>1) collabTag=' <span style="background:var(--hl);color:var(--a);font-size:0.78em;padding:3px 10px;border-radius:10px;font-weight:600;cursor:pointer" onclick="openVr('+i+')">v'+vs.length+'</span>';
    let transContent;
    if(has&&v.content&&v.content.length>0){
      transContent=escapeHtml(v.content);
    }else if(has&&(!v.content||v.content.length===0)){
      transContent='<span style="color:var(--s);font-style:italic">⏳ 等待翻译...</span>';
    }else{
      transContent='<span style="color:var(--s);font-style:italic">⏳ 等待翻译...</span>';
    }
    return'<div class="para'+(has&&v.content?' just-done':'')+'" data-i="'+i+'">'
      +'<span class="n" style="display:flex;justify-content:space-between;align-items:center">'
      +'<span>§ '+(i+1)+(v&&v.author_name&&v.author_name!=='AI'?' · '+v.author_name:'')+'</span>'
      +collabTag
      +'</span>'
      +transContent
      +'<div style="display:flex;gap:6px;margin-top:6px;align-items:center">'
      +(has&&v.content&&session?'<button class="btn sm" onclick="voteTranslation('+i+',1,this)" style="padding:3px 8px">👍 <span id="up'+i+'">-</span></button><button class="btn sm" onclick="voteTranslation('+i+',-1,this)" style="padding:3px 8px">👎 <span id="down'+i+'">-</span></button>':'')
      +(session?'<button class="btn sm" onclick="openEd('+i+')">✏️</button>':'')
      +'<button class="btn sm" onclick="openComment('+i+')">💬'+(comments.length>0?' '+comments.length:'')+'</button>'
      +'</div>'
      +(comments.length>0?'<div class="comments-section" style="margin-top:6px">'+comments.map(c=>'<div class="comment-item"><span class="c-author">'+escapeHtml(c.author_name)+'</span><span class="c-text">'+escapeHtml(c.content)+'</span></div>').join('')+'</div>':'')
      +'<div class="comment-input-row" id="commentRow'+i+'" style="display:none;margin-top:4px"><input id="commentInput'+i+'" placeholder="写评论..."><button onclick="doComment('+i+')">发送</button></div>'
      +'</div>';
  }).join('');
  showReport();updateWC();
}

function showReport(){
  const zh=curBook.zh;if(!zh)return;
  let edits=0,contribs=new Set();
  for(let i=0;i<zh.length;i++){
    const vs=getVersions(i,curLang);
    vs.forEach(v=>{if(v.author_name!=='AI'){edits++;contribs.add(v.author_name);}});
  }
  const editedParas=zh.filter((_,i)=>(commVersions[i+'-'+curLang]||[]).some(v=>v.author_name!=='AI')).length;
  document.getElementById('report').style.display='block';
  document.getElementById('report').innerHTML='<h3>📊 阅读报告</h3><div class="report-grid">'
    +'<div class="report-item"><div class="num">'+zh.length+'</div><div class="lbl">📖 段落</div></div>'
    +'<div class="report-item"><div class="num">'+zh.reduce((s,t)=>s+t.length,0)+'</div><div class="lbl">📝 总字数</div></div>'
    +'<div class="report-item"><div class="num">'+editedParas+'</div><div class="lbl">✏️ 被改进</div></div>'
    +'<div class="report-item"><div class="num">'+contribs.size+'</div><div class="lbl">👥 贡献者</div></div>'
    +'<div class="report-item"><div class="num">'+(commComments?Object.values(commComments).flat().length:0)+'</div><div class="lbl">💬 评论</div></div>'
    +'</div>';
}

function updateWC(){
  const zh=curBook.zh;if(!zh)return;
  document.getElementById('wc').textContent=' · '+zh.length+'段 · '+zh.reduce((s,t)=>s+t.length,0)+'字';
}

function syncScroll(){
  const L=document.getElementById('leftP'),R=document.getElementById('rightP');let s=false;
  function sync(a,b){if(s)return;s=true;const r=a.scrollTop/(a.scrollHeight-a.clientHeight||1);b.scrollTop=r*(b.scrollHeight-b.clientHeight||1);requestAnimationFrame(()=>{s=false;});}
  L.onscroll=()=>sync(L,R);R.onscroll=()=>sync(R,L);
}

function setL(l,el){
  curLang=l;
  document.querySelectorAll('.reader-top button[onclick^="setL"]').forEach(b=>{b.style.background='var(--pbg)';b.style.color='var(--s)';});
  el.style.background='var(--a)';el.style.color='#fff';
  document.getElementById('tlLbl').textContent={en:'English',ja:'日本語',ko:'한국어',fr:'Français'}[l]||'English';
  loadCloudVersions().then(()=>{renderR();showReport();});
}

// ============================================================
// 6. 编辑翻译
// ============================================================
function openEd(i){
  if(!session){alert('请先登录');return;}
  editIdx=i;
  const v=getActive(i,curLang);
  document.getElementById('edI').textContent=i+1;
  document.getElementById('edA').textContent=v?v.author_name:'AI';
  document.getElementById('edO').textContent=curBook.zh[i];
  document.getElementById('edT').value=v?v.content:'';
  const vs=getVersions(i,curLang);
  document.getElementById('edV').textContent=vs.length+1;
  document.getElementById('edM').classList.add('on');
}
function closeEd(){document.getElementById('edM').classList.remove('on');editIdx=null;}
async function doEd(){
  if(editIdx===null)return;
  if(!requireDB())return;
  const t=document.getElementById('edT').value.trim();if(!t){alert('请输入翻译');return;}
  
  // 通过 Edge Function API 提交（含速率限制+内容校验）
  try{
    const resp=await fetch(API_BASE+'/upload-translation',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token},
      body:JSON.stringify({book_id:curBook.id,paragraph_index:editIdx,language:curLang,content:t})
    });
    const result=await resp.json();
    if(!resp.ok){alert('提交失败：'+result.error);return;}
    
    // 更新贡献计数
    await db.from('profiles').update({contributions:(profile?.contributions||0)+1}).eq('id',session.user.id);
    await loadCloudVersions();
    closeEd();renderR();showReport();
  }catch(e){alert('网络错误：'+e.message);}
}

// ============================================================
// 7. 评论
// ============================================================
function openComment(i){
  if(!session){alert('请先登录');return;}
  const row=document.getElementById('commentRow'+i);
  row.style.display=row.style.display==='none'?'flex':'none';
  if(row.style.display!=='none') document.getElementById('commentInput'+i).focus();
}
async function voteTranslation(i,val,btn){
  if(!session){alert('请先登录');return;}
  const v=getActive(i,curLang);if(!v||!v.id){return;}
  // 通过 Edge Function API 投票
  try{
    const resp=await fetch(API_BASE+'/upload-vote',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token},
      body:JSON.stringify({translation_id:v.id,vote:val})
    });
    if(!resp.ok){const r=await resp.json();alert('投票失败：'+r.error);return;}
    loadVoteCounts();
  }catch(e){alert('网络错误：'+e.message);}
}
async function loadVoteCounts(){
  if(!curBook||!db)return;
  const rng=chapterRange();
  for(let i=rng.start;i<rng.end;i++){
    const v=getActive(i,curLang);if(!v||!v.id)continue;
    const{data}=await db.from('translation_votes').select('vote').eq('translation_id',v.id);
    if(!data)continue;
    const up=data.filter(x=>x.vote===1).length,down=data.filter(x=>x.vote===-1).length;
    const ue=document.getElementById('up'+i),de=document.getElementById('down'+i);
    if(ue)ue.textContent=up||'-';if(de)de.textContent=down||'-';
  }
}

async function doComment(i){
  if(!requireDB())return;
  const input=document.getElementById('commentInput'+i);
  const t=input.value.trim();if(!t)return;
  
  // 通过 Edge Function API 提交评论
  try{
    const resp=await fetch(API_BASE+'/upload-comment',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token},
      body:JSON.stringify({book_id:curBook.id,paragraph_index:i,content:t})
    });
    const result=await resp.json();
    if(!resp.ok){alert('评论失败：'+result.error);return;}
    input.value='';
    await loadComments();
    renderR();
  }catch(e){alert('网络错误：'+e.message);}
}

// ============================================================
// 8. 版本历史
// ============================================================
function openVr(i){
  const vs=getVersions(i,curLang);
  let displayVs=vs;
  if(displayVs.length===0){
    const pre=curBook[curLang];
    if(pre&&pre[i]) displayVs=[{version:1,author_name:'AI',content:pre[i]}];
  }
  const currentActive=getActive(i,curLang);
  document.getElementById('vrT').textContent='段落'+(i+1)+' · '+displayVs.length+'个版本 · 当前显示：v'+(currentActive?currentActive.version:'?')+' ('+(currentActive?.author_name||'AI')+')';
  document.getElementById('vrL').innerHTML=displayVs.map(v=>{
    const isCur=currentActive&&v.version===currentActive.version;
    return'<li onclick="setActiveV('+i+','+v.version+')" style="'+(isCur?'background:var(--hl);border-color:var(--a);border-width:2px':'')+'"><div class="vh"><strong>'+escapeHtml(v.author_name)+'</strong><span>v'+v.version+(isCur?' ← 当前显示':'')+'</span></div><div class="vt">'+escapeHtml(v.content.substring(0,400))+'</div></li>';
  }).join('');
  if(displayVs.length>=2){
    document.getElementById('vrDiff').style.display='block';
    document.getElementById('vrDiffC').innerHTML=simpleDiff(displayVs[displayVs.length-2].content,displayVs[displayVs.length-1].content);
  }else{document.getElementById('vrDiff').style.display='none';}
  document.getElementById('vrM').classList.add('on');
}
function closeVr(){document.getElementById('vrM').classList.remove('on');}
async function setActiveV(pi,vn){
  // 保存用户的版本选择
  saveUserActive(pi,curLang,vn);
  closeVr();renderR();showReport();
  // 临时提示
  const el=document.querySelector('#rightC .para[data-i="'+pi+'"]');
  if(el){el.classList.add('just-done');setTimeout(()=>el.classList.remove('just-done'),600);}
}

function simpleDiff(o,n){
  const ow=o.split(/(\s+|[,.!?;:'"()-])/),nw=n.split(/(\s+|[,.!?;:'"()-])/);
  let r='',oi=0,ni=0;
  while(oi<ow.length||ni<nw.length){
    if(oi>=ow.length){r+='<span class="diff-add">'+escapeHtml(nw[ni]||'')+'</span>';ni++}
    else if(ni>=nw.length){r+='<span class="diff-del">'+escapeHtml(ow[oi]||'')+'</span>';oi++}
    else if(ow[oi]===nw[ni]){r+=escapeHtml(ow[oi]);oi++;ni++}
    else{let found=false;
      for(let l=1;l<6&&ni+l<nw.length;l++){if(ow[oi]===nw[ni+l]){for(let k=0;k<l;k++)r+='<span class="diff-add">'+escapeHtml(nw[ni+k]||'')+'</span>';ni+=l;found=true;break}}
      if(!found){r+='<span class="diff-del">'+escapeHtml(ow[oi]||'')+'</span>';oi++;if(ni<nw.length&&ow[oi]!==nw[ni]){r+='<span class="diff-add">'+escapeHtml(nw[ni]||'')+'</span>';ni++}}
    }
  }
  return r||'（无变化）';
}

// ============================================================
// 9. 朗读
// ============================================================
function toggleTheme(){document.body.classList.toggle('dark');}
function flashFirstBook(){
  const cards=document.querySelectorAll('.book-card');
  if(cards.length>0){
    cards[0].scrollIntoView({behavior:'smooth'});
    cards[0].style.boxShadow='0 0 0 5px var(--a)';
    setTimeout(()=>cards[0].style.boxShadow='',800);
  }
}

// 删除书籍
async function deleteBook(){
  if(!curBook||!curBook.isUploaded){alert('无法删除预置书籍');return;}
  if(!session){alert('请先登录');return;}
  if(curBook.uploaderId&&session.user.id!==curBook.uploaderId){alert('无权限：只有上传者可以删除此书');return;}
  if(!confirm('确定要删除《'+curBook.title+'》吗？此操作不可恢复。'))return;
  // 通过 Edge Function API 删除
  try{
    const resp=await fetch(API_BASE+'/delete-book',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token},
      body:JSON.stringify({book_id:curBook.id})
    });
    if(!resp.ok){const r=await resp.json();alert('删除失败：'+r.error);return;}
    delete PRELOAD[curBook.id];
    goLib();alert('✅ 已删除');
  }catch(e){alert('网络错误：'+e.message);}
}

// 浏览器返回键拦截
window.addEventListener('popstate',function(e){
  if(e.state&&e.state.view==='reader'){
    // 用户按返回键 -> 回到资料库
    goLib();
  }else if(e.state&&e.state.view==='library'){
    // 已经在资料库，不做处理
  }
});

// ============================================================
// 10. 工具
// ============================================================
function escapeHtml(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}

// ============================================================
// 11. 启动
// ============================================================
document.addEventListener('DOMContentLoaded',async()=>{
  document.documentElement.style.setProperty('--fs','17px');
  
  // 清理旧localStorage缓存
  try{const keys=Object.keys(localStorage);for(const k of keys){if(k.startsWith('rb_raw_'))localStorage.removeItem(k);}}catch(e){}
  
  // 尝试恢复session（不阻塞页面加载）
  if(db){
    try{const{data}=await db.auth.getSession();if(data.session){session=data.session;await loadProfile();}}catch(e){}
  }
  
  renderNav();
  await renderLib();  // renderLib() 内部调用 checkDBOnline()
  // 处理URL中的#book=参数（支持直接链接到某本书）
  const hash=location.hash;if(hash.startsWith('#book=')){const id=hash.replace('#book=','');setTimeout(()=>openB(id),500);}
  // 翻译粘贴框实时监听
  var tp=document.getElementById('transUpPaste');if(tp){tp.addEventListener('input',function(){transUpText=this.value;if(transUpText.trim().length>50)transUpParas=smartSplit(transUpText);showTransMatch();});}
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeEd();closeVr();closeAuth();closeProf();closeUp();var t=document.getElementById('transUpM');if(t)t.classList.remove('on');document.getElementById('tocPanel').style.display='none';}});
  // 点击空白区域关闭所有弹窗/面板
  document.addEventListener('click',function(e){
    const t=e.target;
    // 如果点击的是弹窗内部或触发按钮，不关闭
    if(t.closest('.box')||t.closest('button')||t.closest('input')||t.closest('textarea')||t.closest('select')||t.closest('#tocPanel')||t.closest('.para')||t.closest('.book-card'))return;
    // 关闭所有弹窗
    ['authModal','edM','vrM','profM','upM'].forEach(id=>document.getElementById(id).classList.remove('on'));
    // 关闭目录
    document.getElementById('tocPanel').style.display='none';
    // 关闭词汇面板（如果存在）
    const vp=document.getElementById('vocabPanel');if(vp)vp.classList.remove('open');
  });
});
window.onerror=function(msg,url,line){console.error('[Error '+new Date().toLocaleTimeString()+'] '+msg+' line '+line);return false;};

// ============================================================
// 暴露 HTML onclick 需要的函数到全局 window
// ============================================================
window.goLib = goLib;
window.flashFirstBook = flashFirstBook;
window.openB = openB;
window.openUp = openUp;
window.setL = setL;
window.downloadBook = downloadBook;
window.openTransUp = openTransUp;
window.deleteBook = deleteBook;
window.copyPrompt = copyPrompt;
window.previewTransFile = previewTransFile;
window.doAuth = doAuth;
window.closeAuth = closeAuth;
window.toggleAuth = toggleAuth;
window.doEd = doEd;
window.closeEd = closeEd;
window.openVr = openVr;
window.closeVr = closeVr;
window.setActiveV = setActiveV;
window.openProf = openProf;
window.closeProf = closeProf;
window.doUp = doUp;
window.closeUp = closeUp;
window.doTransUp = doTransUp;
window.closeTransUp = closeTransUp;
window.doLogout = doLogout;
window.toggleTheme = toggleTheme;
window.openComment = openComment;
window.doComment = doComment;
window.voteTranslation = voteTranslation;
window.translatePara = translatePara;
window.prevChapter = prevChapter;
window.nextChapter = nextChapter;
window.scrollToPara = scrollToPara;
window.toggleSubs = toggleSubs;
window.escapeHtml = escapeHtml;
window.filter = filter;
window.renderNav = renderNav;
window.renderLib = renderLib;

})();
