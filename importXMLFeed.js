const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
const { parseStringPromise, Builder } = require('xml2js');
const fs = require('fs');
const { execSync } = require('child_process');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const xmlUrl = "https://raw.githubusercontent.com/jurajorlicky/xml-import/refs/heads/main/feed.xml";
const xmlFilePath = './feed.xml';

async function importXMLFeed() {
  try {
    console.log("🚀 Fetching XML feed...");
    const response = await fetch(xmlUrl);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    const xmlContent = await response.text();

    // Parse XML do JS objektu
    const parsedData = await parseStringPromise(xmlContent, { explicitArray: true });
    const items = parsedData.SHOP.SHOPITEM || [];

    console.log("📡 Fetching updated product prices and statuses from Supabase...");
    // Získame dáta z tabuľky 'product_price_view'
    const { data: productPrices, error: priceFetchError } = await supabase
      .from('product_price_view')
      .select('product_id, size, final_price, final_status');

    if (priceFetchError) {
      console.error("❌ Error fetching product prices:", priceFetchError);
      return;
    }

    // Vytvoríme mapu (product_id-size) -> { price, status }
    // Ak je final_price alebo final_status null, uložíme tam reálne null
    const priceMap = new Map(
      productPrices.map(p => [
        `${p.product_id}-${p.size}`,
        { 
          price: p.final_price, 
          status: p.final_status 
        }
      ])
    );

    console.log("🛠 Updating XML feed...");
    let changesMade = false;

    for (const item of items) {
      // Overíme, či produkt obsahuje varianty
      if (!item.VARIANTS || !item.VARIANTS[0].VARIANT) {
        continue;
      }

      // Pre každý variant
      for (const variant of item.VARIANTS[0].VARIANT) {
        let size = "Unknown";
        try {
          size = variant.PARAMETERS[0].PARAMETER[0].VALUE[0];
        } catch (err) {
          console.warn(`⚠️ Could not extract size for item id ${item.$.id}:`, err);
        }

        // Vygenerujeme kľúč do mapy
        const key = `${item.$.id}-${size}`;
        const priceData = priceMap.get(key);

        // Ak v DB nič neexistuje, necháme pôvodné hodnoty
        if (!priceData) {
          console.log(`❓ No matching data in Supabase for key: ${key}. Skipping update...`);
          continue;
        }

        // priceData.price môže byť buď number alebo null
        // priceData.status môže byť buď string alebo null
        console.log(`🛠 ${item.$.id} - ${size} → Cena: ${priceData.price}, Status: ${priceData.status}`);

        // Aktualizácia PRICE_VAT, len ak nie je null
        if (priceData.price !== null) {
          const newPriceString = priceData.price.toString();
          if (variant.PRICE_VAT && variant.PRICE_VAT[0] !== newPriceString) {
            variant.PRICE_VAT[0] = newPriceString;
            changesMade = true;
          }
        }

        // Aktualizácia AVAILABILITY_OUT_OF_STOCK, len ak nie je null
        if (priceData.status !== null) {
          if (variant.AVAILABILITY_OUT_OF_STOCK && variant.AVAILABILITY_OUT_OF_STOCK[0] !== priceData.status) {
            variant.AVAILABILITY_OUT_OF_STOCK[0] = priceData.status;
            changesMade = true;
          }
        }
      }
    }

    // Vygenerujeme nové XML
    const builder = new Builder({ headless: true, renderOpts: { pretty: true } });
    const updatedXml = builder.buildObject({ SHOP: { SHOPITEM: items } });

    // Porovnanie s existujúcim feed.xml (ak existuje)
    if (fs.existsSync(xmlFilePath)) {
      const existingXml = fs.readFileSync(xmlFilePath, 'utf8');
      if (existingXml.trim() === updatedXml.trim()) {
        console.log("✅ No changes in XML feed, skipping commit.");
        return;
      }
    }

    if (!changesMade) {
      console.log("✅ No changes detected in product data, skipping commit.");
      return;
    }

    // Uložíme nový feed.xml
    fs.writeFileSync(xmlFilePath, updatedXml);
    console.log("✅ XML Feed updated!");

    // Commit a push do GitHub repozitára
    console.log("🚀 Committing and pushing XML feed to GitHub...");
    execSync("git config --global user.name 'GitHub Actions'");
    execSync("git config --global user.email 'actions@github.com'");
    execSync("git add feed.xml");
    try {
      execSync('git commit -m "🔄 Auto-update XML feed"');
    } catch (commitError) {
      console.log("ℹ️ No changes to commit.");
    }
    execSync(`git push https://x-access-token:${process.env.GITHUB_TOKEN}@github.com/jurajorlicky/xml-import.git main`);
    console.log("✅ XML feed successfully pushed to GitHub!");

  } catch (error) {
    console.error("❌ Error importing XML feed:", error);
  }
}

importXMLFeed();
