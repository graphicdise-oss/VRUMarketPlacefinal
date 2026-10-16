async function searchUnsplash(query) {
  try {
    const res = await fetch('https://unsplash.com/s/photos/' + encodeURIComponent(query), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    const html = await res.text();
    const regex = /https:\/\/images\.unsplash\.com\/photo-([a-zA-Z0-9_-]+)/g;
    const found = new Set();
    let m;
    while ((m = regex.exec(html)) !== null) {
      found.add('https://images.unsplash.com/photo-' + m[1]);
      if (found.size >= 5) break;
    }
    console.log(`=== Query: ${query} ===`);
    for (const u of found) {
      console.log(u);
    }
  } catch (err) {
    console.error(err);
  }
}

async function run() {
  await searchUnsplash('handmade soap bar');
  await searchUnsplash('silk scarf');
  await searchUnsplash('thai food');
  await searchUnsplash('dried banana chips');
  await searchUnsplash('lemongrass spray');
  await searchUnsplash('lotus tea');
  await searchUnsplash('bamboo woven basket');
}
run();
