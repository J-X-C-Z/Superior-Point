"""Offline file:// acceptance; use isolated installed Chromium (no user profile)."""
import json, pathlib, os
from playwright.sync_api import sync_playwright
root=pathlib.Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    engine=os.environ.get('SP_TEST_BROWSER','chromium')
    browser=p.firefox.launch(executable_path=os.environ.get('FIREFOX','/tmp/sp-playwright-browsers/firefox-1538/firefox/firefox'),headless=True,timeout=30000,env={**os.environ,'HOME':'/tmp','XDG_CACHE_HOME':'/tmp/sp-font-cache'}) if engine=='firefox' else p.chromium.launch(timeout=15000,executable_path='/usr/bin/chromium', headless=True,args=['--no-sandbox','--disable-dev-shm-usage'],env={'HOME':'/tmp','PATH':'/usr/bin:/bin'})
    context=browser.new_context(offline=True,viewport={'width':1440,'height':900})
    page=context.new_page(); errors=[]; requests=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('request',lambda r:requests.append(r.url))
    page.goto((root/'examples/five-slides.html').as_uri())
    page.wait_for_function("document.documentElement.dataset.spReady === 'true'")
    assert page.evaluate('spDeck.getTotalSlides()')==5
    assert page.evaluate("async () => { const image=new Image(); image.src=document.querySelector('svg image').getAttribute('href'); await image.decode(); return image.naturalWidth === 480; }")
    page.evaluate('spDeck.slide(2)')
    assert page.locator('section.present .fragment.visible').count()==0
    page.keyboard.press('ArrowRight')
    assert page.evaluate('spDeck.getIndices().h')==2
    assert page.locator('section.present .fragment.visible').count()==2
    page.keyboard.press('ArrowRight')
    assert page.locator('section.present .fragment.visible').count()==3
    page.keyboard.press('ArrowRight')
    assert page.evaluate('spDeck.getIndices().h')==3
    page.keyboard.press('ArrowLeft')
    assert page.evaluate('spDeck.getIndices().h')==2
    assert not errors,errors
    assert not [u for u in requests if u.startswith(('http:','https:'))], requests
    embedded=page.locator('#sp-document').text_content()
    assert json.loads(embedded)==json.loads((root/'examples/five-slides.json').read_text())
    page.evaluate('spDeck.slide(0)');page.wait_for_timeout(500)
    page.screenshot(path=str(root/f'examples/offline-{engine}.png'))
    print(json.dumps({'browser':browser.version,'fileProtocol':True,'offline':True,'pages':5,'fragments':'pass','keyboard':'pass','embeddedData':'unchanged','externalRequests':0,'exceptions':0}))
    browser.close()
