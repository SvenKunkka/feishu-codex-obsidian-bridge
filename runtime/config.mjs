import { homedir } from 'node:os';
import { delimiter,join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_RULES = fileURLToPath(new URL('../skills/personal-feishu-assistant/SKILL.md',import.meta.url));
const present = value => typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** Expand only a leading home shorthand. Values are paths, never shell source. */
export function expandHomePath(value, homeDir = homedir()) {
  const text=String(value);
  if(text==='~') return homeDir;
  if(text.startsWith('~/') || text.startsWith('~\\')) return join(homeDir,text.slice(2));
  return text;
}

/** Pure configuration reader. Launchers may load .env before calling this. */
export function readBridgeConfig({env=process.env,homeDir=homedir()}={}) {
  const pathValue=(name,fallback)=>resolve(expandHomePath(present(env[name]) ?? fallback,homeDir));
  const binary=(name,fallback)=>{
    const value=present(env[name]) ?? fallback;
    const expanded=expandHomePath(value,homeDir);
    return value.includes('/') || value.includes('\\') ? resolve(expanded) : expanded;
  };
  const stateDir=pathValue('FEISHU_WIKI_STATE_DIR',join(homeDir,'.local','share','feishu-codex-obsidian-bridge'));
  return Object.freeze({
    profile:'codex',
    vaultDir:pathValue('FEISHU_WIKI_VAULT',join(homeDir,'Documents','Feishu-WIKI')),
    stateDir,
    larkChannelHome:pathValue('LARK_CHANNEL_HOME',join(stateDir,'lark-channel')),
    rulesPath:pathValue('FEISHU_WIKI_RULES',PACKAGE_RULES),
    browserUseBin:binary('BROWSER_USE_BIN','browser-use'),
    codexBin:binary('CODEX_BIN','codex'),
    ytDlpBin:binary('YTDLP_BIN','yt-dlp'),
    curlBin:binary('CURL_BIN','curl'),
    summaryModel:present(env.FEISHU_SUMMARY_MODEL) ?? 'gpt-5.6-sol',
    summaryEffort:present(env.FEISHU_SUMMARY_EFFORT) ?? 'medium'
  });
}

/** Keep the caller's executable precedence; append common installation paths. */
export function childProcessEnv({env=process.env,homeDir=homedir(),platform=process.platform}={}) {
  const paths=String(env.PATH ?? '').split(delimiter).filter(Boolean);
  const fallback=[join(homeDir,'.local','bin')];
  if(platform==='darwin') fallback.push('/opt/homebrew/bin','/usr/local/bin','/usr/bin','/bin');
  else if(platform!=='win32') fallback.push('/usr/local/bin','/usr/bin','/bin');
  const config=readBridgeConfig({env,homeDir});
  return {...env,PATH:[...new Set([...paths,...fallback])].join(delimiter),LARK_CHANNEL_HOME:config.larkChannelHome};
}

export const bridgeConfig=readBridgeConfig();
