// /server/sources/sinchew.ts
import type { NewsItem } from "@shared/types"

interface HotListItem {
  ID: number | string
  the_permalink?: string
  permalink?: string
  link?: string
  url?: string
  post_title?: string
  title?: string | { rendered?: string }
  post_excerpt?: string
  excerpt?: string
  time?: string
  date_diff?: string
}
interface HotListResponse {
  result?: HotListItem[]
}

type CFInit = RequestInit & {
  cf?: { cacheTtl?: number, cacheEverything?: boolean }
}

const BASE = "https://www.sinchew.com.my"

// Detect Cloudflare Workers/Pages runtime (very lightweight heuristic)
const isWorkers
  = typeof (globalThis as any).WebSocketPair === "function"
    && typeof (globalThis as any).caches !== "undefined"

function pickTitle(it: HotListItem): string {
  if (typeof it.title === "object")
    return (it.title?.rendered ?? "").toString().trim()
  return (it.post_title ?? (it.title as string) ?? "").toString().trim()
}
function pickUrl(it: HotListItem): string | null {
  const href = it.the_permalink || it.permalink || it.link || it.url
  if (!href) return null
  return href.startsWith("http") ? href : new URL(href, BASE).toString()
}

async function fetchHotJSON(page: number, range: "6H" | "1D" | "1W") {
  const url = new URL("/hot-post-list/", BASE)
  url.search = new URLSearchParams({
    taxid: "-1",
    page: String(page),
    range,
    umcl: "Y",
    _: String(Date.now()), // mimic XHR cache-buster
  }).toString()

  const init: CFInit = {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "X-Requested-With": "XMLHttpRequest",
      "Referer": `${BASE}/hot-posts/`,
    },
    redirect: "follow",
    method: "GET",
  }
  if (isWorkers) {
    init.cf = { cacheTtl: 120, cacheEverything: true }
  }
  const raw: any = await myFetch(url.toString(), init)

  const data: HotListResponse = typeof raw === "string" ? JSON.parse(raw) : raw
  const list = Array.isArray(data?.result) ? data.result! : []
  return { list, ok: list.length > 0 }
}

// Fallback: WP REST (latest posts). Not “hot”, but gives basic values in prod.
interface WPPost {
  id: number
  link: string
  title: { rendered: string }
  excerpt?: { rendered?: string }
  date?: string
}
async function fetchWPBasics(): Promise<NewsItem[]> {
  const url = `${BASE}/wp-json/wp/v2/posts?per_page=10&_fields=id,link,title,excerpt,date`
  const wpInit: CFInit = {
    headers: {
      "Accept": "application/json",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "Referer": `${BASE}/`,
    },
    redirect: "follow",
    method: "GET",
  }
  if (isWorkers) {
    wpInit.cf = { cacheTtl: 300, cacheEverything: true }
  }
  const raw: any = await myFetch(url, wpInit)

  const posts: WPPost[] = typeof raw === "string" ? JSON.parse(raw) : raw
  const seen = new Set<string>()
  const news: NewsItem[] = []
  for (const p of posts || []) {
    if (!p?.link || !p?.title?.rendered) continue
    if (seen.has(p.link)) continue
    seen.add(p.link)
    news.push({
      id: p.id,
      title: p.title.rendered.replace(/<[^>]+>/g, "").trim(),
      url: p.link,
      pubDate: p.date,
      extra: {
        hover:
          p.excerpt?.rendered
            ?.replace(/<[^>]+>/g, "")
            .replace(/\s+/g, " ")
            .trim() || undefined,
        info: false,
      },
    })
  }
  return news
}

const hotnews = defineSource(async () => {
  // your current plan: 1D, page=3
  const page = 3 as const
  const { list, ok } = await fetchHotJSON(page, "1D").catch(() => ({
    list: [],
    ok: false,
  }))

  // If Cloudflare deploy returns 403/empty, gracefully fall back to WP REST
  if (!ok && isWorkers) {
    const fallback = await fetchWPBasics()
    if (fallback.length) return fallback
  }

  // Map basic values
  const news: NewsItem[] = []
  for (const it of list) {
    const url = pickUrl(it)
    const title = pickTitle(it)
    if (!url || !title) continue
    news.push({
      id: it.ID ?? url,
      title,
      url,
      pubDate: it.time,
      extra: {
        info: it.date_diff || undefined, // e.g., "2小时前"
        hover:
          (it.post_excerpt ?? it.excerpt ?? "")
            .toString()
            .replace(/<[^>]+>/g, "")
            .replace(/\s+/g, " ")
            .trim() || undefined,
      },
    })
  }
  return news
})

export default defineSource({
  sinchew: hotnews,
})
