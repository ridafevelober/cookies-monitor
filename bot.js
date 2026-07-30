const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID;
const SEPARATOR_GIF = 'https://media.discordapp.net/attachments/1504994777257738275/1532199182117507202/cookies-line.gif';
const STATE_FILE = path.join(__dirname, 'state.json');
const TEAM_URL = 'https://azorafly.com/teams/cookies';
const CHECK_INTERVAL = 5 * 60 * 1000;
const FOLLOW_UP_DELAY = 10 * 60 * 1000;

if (!BOT_TOKEN || !CHANNEL_ID) {
  console.error('Missing BOT_TOKEN or CHANNEL_ID');
  process.exit(1);
}

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
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
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
      if (!isNaN(n) && text === n.toString()) numbers.push(n);
    });
    let views = 0, likes = 0;
    if (numbers.length >= 3) { views = numbers[0]; likes = numbers[2]; }
    else if (numbers.length === 2) { views = numbers[0]; likes = numbers[1]; }
    else if (numbers.length === 1) { views = numbers[0]; }
    chapters.push({ num, views, likes });
  });

  chapters.sort((a, b) => b.num - a.num);
  return { name, image, latest: chapters[0] || null };
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.once('ready', async () => {
  console.log('Bot ready as ' + client.user.tag);
  const state = loadState();
  const isFirstRun = Object.keys(state.chapters).length === 0;

  async function check() {
    try {
      const channel = await client.channels.fetch(CHANNEL_ID);
      console.log('[' + new Date().toISOString() + '] Checking...');
      const teamHtml = await fetchText(TEAM_URL);
      const seriesSlugs = extractSeriesFromTeam(teamHtml);
      console.log('Found ' + seriesSlugs.length + ' series');

      for (const slug of seriesSlugs) {
        try {
          const html = await fetchText('https://azorafly.com/series/' + slug);
          const series = extractChapterData(html);
          if (!series.latest) continue;
          const stored = state.chapters[slug];
          if (!stored || stored < series.latest.num) {
            state.chapters[slug] = series.latest.num;
            if (!isFirstRun) {
              console.log('New: ' + series.name + ' ch.' + series.latest.num);
              const msg = await channel.send({
                content: '@everyone 🔥 **' + series.name + '**\n**الفصل ' + series.latest.num + '** متاح الآن بواسطة فريق **🍪 Cookies**',
                embeds: [{
                  title: series.name,
                  description: '**الفصل ' + series.latest.num + '** متاح الآن للقراءة!',
                  color: 0xFF6B6B,
                  fields: [
                    { name: '👁️ المشاهدات', value: series.latest.views.toLocaleString(), inline: true },
                    { name: '❤️ الإعجابات', value: series.latest.likes.toLocaleString(), inline: true },
                    { name: '🍪 الفريق', value: 'Cookies', inline: true }
                  ],
                  image: { url: series.image },
                  footer: { text: 'AzoraFly • Cookies Team' },
                  timestamp: new Date().toISOString()
                }]
              });
              await channel.send(SEPARATOR_GIF);
              state.pendingFollowUps.push({
                slug, chapterNum: series.latest.num, seriesName: series.name,
                messageId: msg.id, scheduledAt: Date.now() + FOLLOW_UP_DELAY
              });
            } else {
              console.log('Initialized: ' + series.name + ' ch.' + series.latest.num);
            }
          }
        } catch (e) {
          console.error('Error checking ' + slug + ': ' + e.message);
        }
      }

      const now = Date.now();
      const remaining = [];
      for (const fup of state.pendingFollowUps) {
        if (now >= fup.scheduledAt) {
          try {
            console.log('Follow-up for ' + fup.seriesName + ' ch.' + fup.chapterNum);
            const msg = await channel.messages.fetch(fup.messageId).catch(() => null);
            if (msg) {
              await msg.reply({
                content: '✅ **تم التفعيل** - بفضل إصدار **' + fup.seriesName + '** الفصل **' + fup.chapterNum + '**، أصبح التسجيل في موقع **Cookies** متاحاً!',
                embeds: [{
                  title: '🎉 تم تفعيل التسجيل!',
                  description: '**' + fup.seriesName + '** - الفصل **' + fup.chapterNum + '**\n\nبفضل هذا الإصدار، أصبح التسجيل في موقع **🍪 Cookies** متاحاً الآن!\n\n⚡ **سارع بالتسجيل** واستمتع بأحدث الفصول!',
                  color: 0x43B581,
                  footer: { text: 'Cookies Team • تم التفعيل' },
                  timestamp: new Date().toISOString()
                }]
              });
            }
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
    } catch (e) {
      console.error('Check error: ' + e.message);
    }
  }

  await check();
  setInterval(check, CHECK_INTERVAL);
});

client.login(BOT_TOKEN);