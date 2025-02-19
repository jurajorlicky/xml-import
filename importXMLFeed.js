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
    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
    const xmlContent = await response.text();

    // Používame explicitArray: true pre konzistentnú štruktúru
    const parsedData = await parseStringPromise(xmlContent, { explicitArray: true });
    const items = parsedData.SHOP.SHOPITEM || [];

    console.log("📡 Fetching updated product prices and statuses from Supabase...");
    const { data: productPrices, error: priceFetchError } = await supabase
      .from('product_price_view')
      .select('product_id, size, final_price, final_status');

    if (priceFetchError) {
      console.error("❌ Error fetching product prices:", priceFetchError);
      return;
    }
    
    // Vytvorenie mapy pre rýchle vyhľadávanie
    const priceMap = new Map(productPrices.map(p => [`${p.product_id}-${p.size}`, { price: p.final_price, status: p.final_status }]));

    console.log("🛠 Updating XML feed...");
    let changesMade = false;

    for (const item of items) {
      // Pre každý produkt budeme zisťovať, či má aspoň jeden variant so statusom "SKLADOM EXPRES"
      let hasExpresne = false;
      
      if (item.VARIANTS && item.VARIANTS[0].VARIANT) {
        for (const variant of item.VARIANTS[0].VARIANT) {
          let size = "Unknown";
          try {
            size = variant.PARAMETERS[0].PARAMETER[0].VALUE[0];
          } catch (err) {
            console.warn(`⚠️ Could not extract size for item id ${item.$.id}:`, err);
          }
          const key = `${item.$.id}-${size}`;
          const priceData = priceMap.get(key) || { price: "0", status: "Neznámy" };

          console.log(`🛠 ${item.$.id} - ${size} → Cena: ${priceData.price}, Status: ${priceData.status}`);
          
          // Aktualizácia ceny len ak sa líši
          if (variant.PRICE_VAT[0] !== priceData.price.toString()) {
            variant.PRICE_VAT[0] = priceData.price.toString();
            changesMade = true;
          }
          // Aktualizácia stavu len ak sa líši
          if (variant.AVAILABILITY_OUT_OF_STOCK[0] !== priceData.status) {
            variant.AVAILABILITY_OUT_OF_STOCK[0] = priceData.status;
            changesMade = true;
          }
          // Ak je status "SKLADOM EXPRES", nastavíme príznak
          if (priceData.status === "SKLADOM EXPRES") {
            hasExpresne = true;
          }
        }
      }
      
      // Nastavenie flagu "expresne-odoslanie" podľa stavu variantov:
      // Ak aspoň jeden variant má status "SKLADOM EXPRES", flag bude ACTIVE "1", inak "0".
      const newFlagValue = hasExpresne ? "1" : "0";
      if (!item.FLAGS) {
        item.FLAGS = [{}];
        changesMade = true;
      }
      if (!item.FLAGS[0].FLAG) {
        item.FLAGS[0].FLAG = [];
        changesMade = true;
      }
      let flagIndex = item.FLAGS[0].FLAG.findIndex(f => f.CODE && f.CODE[0] === "expresne-odoslanie");
      if (flagIndex === -1) {
        // Ak flag neexistuje, vytvoríme ho s hodnotou newFlagValue
        item.FLAGS[0].FLAG.push({ CODE: ["expresne-odoslanie"], ACTIVE: [newFlagValue] });
        changesMade = true;
      } else {
        // Ak flag existuje, aktualizujeme ho len v prípade, že sa hodnota líši
        if (item.FLAGS[0].FLAG[flagIndex].ACTIVE[0] !== newFlagValue) {
          item.FLAGS[0].FLAG[flagIndex].ACTIVE[0] = newFlagValue;
          changesMade = true;
        }
      }
    }

    const builder = new Builder({ headless: true, renderOpts: { pretty: true } });
    const updatedXml = builder.buildObject({ SHOP: { SHOPITEM: items } });

    // Porovnanie so súčasným obsahom súboru
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

    fs.writeFileSync(xmlFilePath, updatedXml);
    console.log("✅ XML Feed updated!");

    // Commit a push na GitHub
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

