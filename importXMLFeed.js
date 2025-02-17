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
        const parsedData = await parseStringPromise(xmlContent);
        const items = parsedData.SHOP.SHOPITEM || [];

        console.log("📡 Fetching updated product prices and statuses from Supabase...");
        const { data: productPrices, error: priceFetchError } = await supabase
            .from('product_price_view')
            .select('product_id, size, final_price, final_status');

        if (priceFetchError) {
            console.error("❌ Error fetching product prices:", priceFetchError);
            return;
        }

        const priceMap = new Map(productPrices.map(p => [`${p.product_id}-${p.size}`, { price: p.final_price, status: p.final_status }]));

        console.log("🛠 Updating XML feed...");
        
        for (const item of items) {
            let hasExpresne = false;
            
            if (item.VARIANTS && item.VARIANTS[0].VARIANT) {
                for (const variant of item.VARIANTS[0].VARIANT) {
                    const size = variant.PARAMETERS?.[0]?.PARAMETER?.[0]?.VALUE?.[0] || "Unknown";
                    const key = `${item.$.id}-${size}`;
                    const priceData = priceMap.get(key) || { price: 0, status: "Neznámy" };
                    
                    console.log(`🛠 ${item.$.id} - ${size} → Cena: ${priceData.price}, Status: ${priceData.status}`);
                    
                    variant.PRICE_VAT = [priceData.price.toString()];
                    variant.AVAILABILITY_OUT_OF_STOCK = [priceData.status];
                    
                    if (priceData.status === "SKLADOM EXPRES") hasExpresne = true;
                }
            }
            
            if (!item.FLAGS) item.FLAGS = [{}];
            item.FLAGS[0].FLAG = [{ CODE: "expresne-odoslanie", ACTIVE: hasExpresne ? "1" : "0" }];
        }

        const builder = new Builder({ headless: true });
        const updatedXml = builder.buildObject({ SHOP: { SHOPITEM: items } });

        // Porovnanie, či sa zmenil obsah XML
        if (fs.existsSync(xmlFilePath)) {
            const existingXml = fs.readFileSync(xmlFilePath, 'utf8');
            if (existingXml === updatedXml) {
                console.log("✅ No changes in XML feed, skipping commit.");
                return;
            }
        }

        fs.writeFileSync(xmlFilePath, updatedXml);
        console.log("✅ XML Feed updated!");

        // 🛠 Commit a push XML na GitHub
        console.log("🚀 Committing and pushing XML feed to GitHub...");
        execSync("git config --global user.name 'GitHub Actions'");
        execSync("git config --global user.email 'actions@github.com'");
        execSync("git add feed.xml");
        execSync('git commit -m "🔄 Auto-update XML feed" || echo "No changes to commit"');

        // 🔥 **Opravený príkaz na push cez GITHUB_TOKEN**
        execSync(`git push https://x-access-token:${process.env.GITHUB_TOKEN}@github.com/jurajorlicky/xml-import.git main`);

        console.log("✅ XML feed successfully pushed to GitHub!");
    } catch (error) {
        console.error("❌ Error importing XML feed:", error);
    }
}

importXMLFeed();

