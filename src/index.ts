import * as pLimit from 'p-limit'
import pRetry from 'p-retry'
import * as playwright from 'playwright'
import { BrowserContext, Page } from 'playwright'
import { createPDF } from './pdf'
import * as fs from 'fs-extra'

const homePage = 'https://manhua.dmzj.com/areawuyi/'

main()

async function main() {
  const browser = await playwright['chromium'].launch({
    // headless: false,
  })
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.setViewportSize({
    width: 1920,
    height: 2560,
  })

  await page.goto(homePage)

  const aTags = await page.$$eval('.cartoon_online_border a', (aTags) =>
    aTags.map((item) => item.getAttribute('href'))
  )

  console.log('all: ' + aTags.length)

  const allPageUrls = aTags.map(
    (item) => `https://manhua.dmzj.com${item}#@page=`
  )

  for await (const url of allPageUrls) {
    console.log('url', url)

    try {
      await getOne(context, url)
    } catch (err) {
      console.error('url error', url, err)
    }
  }

  await browser.close()
}

async function getOne(context: BrowserContext, pageUrl: string) {
  //
  const pageNumArray = await pRetry(
    async () => {
      const page = await context.newPage()

      await page.setViewportSize({
        width: 1920,
        height: 2560,
      })

      const result = await getPageNum(page, pageUrl)
      await page.close()
      return result
    },
    {
      retries: 20,
    }
  )

  //

  const limit = pLimit(2)
  const tasks = []

  for (const currentPageNum of pageNumArray) {
    const input = limit(async () => {
      try {
        return await pRetry(() => pageTask(context, currentPageNum, pageUrl), {
          retries: 20,
        })
      } catch (err) {
        console.error('url error', pageUrl, err)
      }
    })

    tasks.push(input)
  }

  const [result] = await Promise.all(tasks)

  console.log(result)

  try {
    await createPDF(result.name, result.chapter, pageNumArray.length)

    console.log(result.name, result.chapter, 'pdf')
  } catch (err) {
    console.error(err)
  }
}

async function getPageNum(page: Page, pageUrl: string) {
  await page.goto(pageUrl + '1')

  const pageNum = await page.$eval(
    '#page_select',
    (element) => element.children.length
  )

  const pageNumArray = []

  for (let i = 0; i < pageNum; i++) {
    pageNumArray.push(i + 1)
  }

  return pageNumArray
}

async function pageTask(
  context: BrowserContext,
  pageNum: number,
  pageUrl: string
) {
  console.log(`${pageUrl}${pageNum}`)
  const start = new Date()

  const page = await context.newPage()

  page.route('**/*.{css,json,htm,gif,ico}', (route) => route.abort())
  page.route('**/auto_dup', (route) => route.abort())

  await page.setViewportSize({
    width: 1920,
    height: 2560,
  })

  await page.goto(`${pageUrl}${pageNum}`)

  console.log('load', new Date().getTime() - start.getTime())

  const chapter = await page.$eval(
    '.display_middle > span',
    (element) => element.textContent
  )

  const name = await page.$eval(
    '.display_middle > h1',
    (element) => element.textContent
  )

  const path = `files/${name.trim()}/${chapter.trim()}/${pageNum}.jpg`
  const result = {
    name: name.trim(),
    chapter: chapter.trim(),
    path,
  }

  if (fs.existsSync(path)) {
    return result
  }

  await page.$eval('.footer', (element) => (element.style.display = 'none'))
  await page.$eval('.login_tip', (element) => {
    if (element) element.style.display = 'none'
  })
  await page.$eval('#show_tip_bg', (element) => {
    if (element) element.style.display = 'none'
  })

  const elementHandle = await page.$('#center_box > img')
  await elementHandle.screenshot({
    path,
  })

  console.log(path, new Date().getTime() - start.getTime())

  await page.close()

  return result
}
