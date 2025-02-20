const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
const { parseStringPromise, Builder } = require('xml2js');
const fs = require('fs');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const xmlFilePath = './feed.xml';  // Lokálny XML súbor na prepisovanie
const xmlUrl = "https://raw.githubusercontent.com/jurajorlicky/xml-import/main/feed.xml";

async function updateXMLPrices() {
    try {
        console.log("🚀 Fetching XML feed...");
        const response = await fetch(xmlUrl);
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        const xmlContent = await response.text();

        console.log("🔍 Parsing XML...");
        const parsedData = await parseStringPromise(xmlContent, { explicitArray: true });
        const items = parsedData.SHOP.SHOPITEM || [];

        console.log("📡 Fetching updated product prices from Supabase...");
        // Získanie upravených cien a statusov pre produkty v `user_products`
        const { data: updatedProducts, error: fetchError } = await supabase
            .from('product_price_view')
            .select('product_id, size, final_price, final_status');

        if (fetchError) {
            console.error("❌ Error fetching product prices:", fetchError);
            return;
        }

        // Vytvorenie mapy (product_id-size) -> { price, status }
        const priceMap = new Map(
            updatedProducts.map(p => [
                `${p.product_id}-${p.size}`,
                { price: p.final_price, status: p.final_status }
            ])
        );

        console.log("🛠 Updating XML prices and stock status...");
        let changesMade = false;

        for (const item of items) {
            if (!item.VARIANTS || !item.VARIANTS[0].VARIANT) continue;

            for (const variant of item.VARIANTS[0].VARIANT) {
                let size = "Unknown";
                try {
                    size = variant.PARAMETERS?.[0]?.PARAMETER?.[0]?.VALUE?.[0] || "Unknown";
                } catch (err) {
                    console.warn(`⚠️ Could not extract size for item id ${item.$.id}:`, err);
                }

                const key = `${item.$.id}-${size}`;
                const priceData = priceMap.get(key);

                if (!priceData) continue; // Ak neexistuje update, preskočíme

                console.log(`🔄 Updating ${item.$.id} - ${size} → Cena: ${priceData.price}, Status: ${priceData.status}`);

                // Aktualizácia ceny, ak sa líši
                if (priceData.price !== null) {
                    const newPriceString = priceData.price.toString();
                    if (variant.PRICE_VAT && variant.PRICE_VAT[0] !== newPriceString) {
                        variant.PRICE_VAT[0] = newPriceString;
                        changesMade = true;
                    }
                }

                // Aktualizácia skladovej dostupnosti, ak sa líši
                if (priceData.status !== null) {
                    if (variant.AVAILABILITY_OUT_OF_STOCK && variant.AVAILABILITY_OUT_OF_STOCK[0] !== priceData.status) {
                        variant.AVAILABILITY_OUT_OF_STOCK[0] = priceData.status;
                        changesMade = true;
                    }
                }
            }
        }

        if (!changesMade) {
            console.log("✅ No changes detected in XML, skipping update.");
            return;
        }

        console.log("📄 Writing updated XML feed...");
        const builder = new Builder({ headless: true, renderOpts: { pretty: true } });
        const updatedXml = builder.buildObject({ SHOP: { SHOPITEM: items } });

        // Uloženie späť do pôvodného súboru
        fs.writeFileSync(xmlFilePath, updatedXml);
        console.log("✅ XML Feed successfully updated!");

    } catch (error) {
        console.error("❌ Error processing XML:", error);
    }
}

updateXMLPrices();
