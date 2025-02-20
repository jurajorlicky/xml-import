const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
const { parseStringPromise } = require('xml2js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const xmlUrl = "https://raw.githubusercontent.com/jurajorlicky/xml-import/main/feed.xml";

async function fetchAndProcessXML() {
    try {
        console.log("🚀 Fetching latest XML feed...");
        const response = await fetch(xmlUrl, { headers: { 'Cache-Control': 'no-cache' } });
        if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
        const xmlContent = await response.text();

        console.log("🔍 Parsing XML...");
        const parsedData = await parseStringPromise(xmlContent, { explicitArray: true });
        const items = parsedData.SHOP.SHOPITEM || [];

        console.log("📡 Fetching existing products from Supabase...");
        const { data: existingProducts, error: fetchError } = await supabase
            .from('products')
            .select('id');

        if (fetchError) {
            console.error("❌ Error fetching existing products:", fetchError);
            return;
        }

        let existingProductIds = new Set(existingProducts.map(p => p.id));
        let newProducts = [];

        console.log("🛠 Processing products...");
        for (const item of items) {
            const productId = item.$.id;
            const name = item.NAME?.[0] || "Unknown";

            if (!existingProductIds.has(productId)) {
                console.log(`🆕 Adding new product: ${name} (${productId})`);
                newProducts.push({ id: productId, name });
            } else {
                console.log(`⚠️ Product already exists, skipping: ${name} (${productId})`);
            }
        }

        // 🛠 Použijeme UPSERT na vloženie len nových produktov
        if (newProducts.length > 0) {
            console.log(`🚀 Upserting ${newProducts.length} new products...`);
            const { error: insertError } = await supabase
                .from('products')
                .upsert(newProducts, { onConflict: ['id'] });

            if (insertError) console.error("❌ Error inserting products:", insertError);
            else console.log(`✅ Inserted ${newProducts.length} new products.`);
        } else {
            console.log("✅ No new products to insert.");
        }

        console.log("✅ All updates finished.");

    } catch (error) {
        console.error("❌ Error processing XML:", error);
    }
}

fetchAndProcessXML();
