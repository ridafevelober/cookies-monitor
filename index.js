const http = require('http');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const WEBHOOK_URL = 'https://discord.com/api/webhooks/1532198155599478838/XBx3gLHn-HygocnEyIPqS6DqNgfKfRfT7rAk8nAbG_Sj2p7NYMOzNS-K1JU9fOzOitQ2';
const WEBHOOK_URL_WAIT = WEBHOOK_URL + '?wait=true';
const SEPARATOR_GIF = 'https://media.discordapp.net/attachments/1504994777257738275/1532199182117507202/cookies-line.gif?ex=6a6bfb2f&is=6a6aa9af&hm=66b1e5800a1e4dc4eace380de7c6797d2c05e84e93f764a56ee325a856849de9&=&width=1100&height=172';
const STATE_FILE = path.join(__dirname, 'state.json');
const TEAM_URL = 'https://azorafly.com/teams/cookies';

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading state:', e.message);
  }
  return { chapters: {}, pendingFollowUps: [] };
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function fetchText(url) {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });
  if (!resp.ok) throw new Error('HTTP ' + resp.status + ' for ' + url);
  return resp.text();
}

function extractSeriesFromTeam(html) {
  const $ = cheerio.load(html);
  const seen = new Set();
  $('a[href^="/series/"]').each((i, el) => {
    const href = $(el).attr('href');
    const match = href.match(/^\/series\/([a-z0-9-]+)$/);
    if (match) {
      const slug = match[1];
      if (slug !== 'featured') seen.add(slug);
    }
  });
  return Array.from(seen);
}

function extractChapterData(html) {
  const $ = cheerio.load(html);
  const name = $('title').text().replace(/\s*(مانهوا|رواية)\s*$/, '').trim();
  const ogImage = $('meta[property="og:image"]').attr('content') || '';
  const storageMatch = html.match(/https:\/\/storage\.azorafly\.com\/upload\/series\/featured\/[^"'\s]+/);
  const storageImage = storageMatch ? storageMatch[0] : '';
  const image = ogImage || storageImage;

  const chapters = [];
  $('a[href*="chapter-"]').each((i, el) => {
    const href = $(el).attr('href');
    const match = href.match(/chapter-(\d+)$/);
    if (!match) return;
    const num = parseInt(match[1]);
    const row = $(el).closest('div').parent();
    const lastDiv = row.find(' > div:last-child');

    const numbers = [];
    lastDiv.find('span, p').each((i2, el2) => {
      const text = $(el2).text().trim();
      const n = parseInt(text);
      if (!isNaN(n) && text === n.toString()) {
        numbers.push(n);
      }
    });

    let views = 0, likes = 0;
    if (numbers.length >= 3) {
      views = numbers[0];
      likes = numbers[2];
    } else if (numbers.length === 2) {
      views = numbers[0];
      likes = numbers[1];
    } else if (numbers.length === 1) {
      views = numbers[0];
    }

    chapters.push({ num, views, likes });
  });

  chapters.sort((a, b) => b.num - a.num);
  const latest = chapters[0] || null;
  return { name, image, latest };
}

async function sendDiscord(payload, wait) {
  const url = wait ? WEBHOOK_URL_WAIT : WEBHOOK_URL;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) {
    const text = await resp.text();
    console.error('Discord error:', resp.status, text.substring(0, 200));
    return null;
  }
  if (wait) {
    try { return await resp.json(); } catch { return null; }
  }
  return null;
}

async function sendNewChapterNotification(series, chapter) {
  const embed = {
    title: series.name,
    description: '━━━━━━━━━━━━━━━━━━━━━\n> ## 🎯 **الفصل ' + chapter.num + '**\n> ### 📅 متاح الآن للقراءة!\n━━━━━━━━━━━━━━━━━━━━━',
    color: 0xFF6B6B,
    fields: [
      { name: '👁️ المشاهدات', value: chapter.views.toLocaleString(), inline: true },
      { name: '❤️ الإعجابات', value: chapter.likes.toLocaleString(), inline: true },
      { name: '🍪 الفريق', value: 'Cookies', inline: true }
    ],
    image: { url: series.image },
    footer: { text: 'AzoraFly • Cookies Team', icon_url: 'https://azorafly.com/favicon.ico' },
    timestamp: new Date().toISOString()
  };

  const msg = await sendDiscord({
    content: '<@&1532198155599478838> 🔥 **' + series.name + '**\n━━━━━━━━━━━━━━━━━━━━━\n**الفصل ' + chapter.num + '** تم رفعه بواسطة فريق **🍪 Cookies**\n━━━━━━━━━━━━━━━━━━━━━\n@everyone',
    embeds: [embed]
  }, true);

  if (msg && msg.id) {
    await sendDiscord({ content: SEPARATOR_GIF });
    return msg.id;
  }
  return null;
}

async function sendFollowUp(series, chapter, replyToId) {
  const embed = {
    title: '🎉 تم تفعيل التسجيل!',
    description: '━━━━━━━━━━━━━━━━━━━━━\n**' + series.name + '** - الفصل **' + chapter.num + '**\n━━━━━━━━━━━━━━━━━━━━━\n\n> بفضل هذا الإصدار، أصبح التسجيل في موقع **🍪 Cookies** متاحاً الآن!\n\n⚡ **سارع بالتسجيل** واستمتع بأحدث الفصول الحصرية والمحتوى المميز.\n\n━━━━━━━━━━━━━━━━━━━━━',
    color: 0x43B581,
    thumbnail: { url: series.image },
    footer: { text: 'Cookies Team • تم التفعيل', icon_url: 'https://azorafly.com/favicon.ico' },
    timestamp: new Date().toISOString()
  };

  await sendDiscord({
    content: '✅ **تم التفعيل** - بفضل إصدار **' + series.name + '** الفصل **' + chapter.num + '**، أصبح التسجيل في موقع **Cookies** متاحاً!\n\nسارع الآن بالتسجيل! 🔥',
    embeds: [embed],
    message_reference: { message_id: replyToId }
  });
}

async function checkForUpdates() {
  console.log('[' + new Date().toISOString() + '] Checking...');
  const state = loadState();

  try {
    const teamHtml = await fetchText(TEAM_URL);
    const seriesSlugs = extractSeriesFromTeam(teamHtml);
    console.log('Found ' + seriesSlugs.length + ' series');

    const pending = state.pendingFollowUps || [];

    const isFirstRun = Object.keys(state.chapters).length === 0;

    for (const slug of seriesSlugs) {
      try {
        const html = await fetchText('https://azorafly.com/series/' + slug);
        const series = extractChapterData(html);
        if (!series.latest) continue;

        const stored = state.chapters[slug];
        if (!stored || stored < series.latest.num) {
          state.chapters[slug] = series.latest.num;

          if (!isFirstRun) {
            console.log('New: ' + series.name + ' ch.' + series.latest.num + ' (views:' + series.latest.views + ' likes:' + series.latest.likes + ')');
            const msgId = await sendNewChapterNotification(series, series.latest);
            if (msgId) {
              pending.push({
                slug, chapterNum: series.latest.num, seriesName: series.name, messageId: msgId,
                scheduledAt: Date.now() + 10 * 60 * 1000
              });
            }
          } else {
            console.log('Initialized: ' + series.name + ' ch.' + series.latest.num);
          }
        }
      } catch (e) {
        console.error('Error checking ' + slug + ': ' + e.message);
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    const now = Date.now();
    const remaining = [];
    for (const fup of pending) {
      if (now >= fup.scheduledAt) {
        try {
          console.log('Follow-up for ' + fup.seriesName + ' ch.' + fup.chapterNum);
          const html = await fetchText('https://azorafly.com/series/' + fup.slug);
          const series = extractChapterData(html);
          await sendFollowUp({ name: fup.seriesName, image: series.image }, { num: fup.chapterNum }, fup.messageId);
        } catch (e) {
          console.error('Follow-up error: ' + e.message);
          remaining.push(fup);
        }
      } else {
        remaining.push(fup);
      }
    }
    state.pendingFollowUps = remaining;
    saveState(state);
    console.log('Done.');
    return { ok: true };
  } catch (e) {
    console.error('Error: ' + e.message);
    return { ok: false, error: e.message };
  }
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/check' && req.method === 'GET') {
    const result = await checkForUpdates();
    res.writeHead(result.ok ? 200 : 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } else if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Cookies Monitor running. Use /check');
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server on port ' + PORT));
