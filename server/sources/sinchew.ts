// /server/sources/sinchew.ts
import type { NewsItem } from "@shared/types"

// --- minimal JSON types for this endpoint ---
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
  cat?: string
  result?: HotListItem[]
}

const BASE = "https://www.sinchew.com.my"

// pick title and url from various possible fields
function pickTitle(it: HotListItem): string {
  if (typeof it.title === "object") return (it.title?.rendered ?? "").toString().trim()
  return (it.post_title ?? (it.title as string) ?? "").toString().trim()
}
function pickUrl(it: HotListItem): string | null {
  const href = it.the_permalink || it.permalink || it.link || it.url
  if (!href) return null
  return href.startsWith("http") ? href : new URL(href, BASE).toString()
}

async function fetchHot(page: number): Promise<HotListItem[]> {
  const url = new URL("/hot-post-list/", BASE)
  url.search = new URLSearchParams({
    taxid: "-1",
    page: String(page),
    range: "1D",
    umcl: "Y",
  }).toString()

  const raw: any = await myFetch(url.toString(), {
    headers: {
      "User-Agent": "newsnow-bot/1.0",
      "Accept": "application/json, text/plain, */*",
      "X-Requested-With": "XMLHttpRequest",
      "Referer": `${BASE}/hot-posts/`,
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    },
  })

  const data: HotListResponse = typeof raw === "string" ? JSON.parse(raw) : raw
  return Array.isArray(data?.result) ? data.result : []
}

// --- single-call 6H hot list (page=3) ---
const hotnews = defineSource(async () => {
  const page = 8

  let list = await fetchHot(page)
  if (list.length === 0 && page !== 1) {
    // some pages can be empty — try page 1 as a basic fallback
    list = await fetchHot(1)
  }

  const news: NewsItem[] = []
  for (const it of list) {
    const url = pickUrl(it)
    const title = pickTitle(it)
    if (!url || !title) continue

    news.push({
      id: it.ID ?? url,
      title,
      url,
      pubDate: it.time, // raw string from API
      extra: {
        info: it.date_diff || undefined, // e.g. "2小时前"
        hover: (it.post_excerpt ?? it.excerpt ?? "").toString().trim() || undefined,
      },
    })
  }

  return news
})

export default defineSource({
  sinchew: hotnews,
})
