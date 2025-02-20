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
        let newSizes = [];

        console.log("🛠 Processing products...");
        for (const item of items) {
            const productId = item.$.id;
            const name = item.NAME?.[0] || "Unknown";
            const imageUrl = item.IMGURL?.[0] || null; // Skontrolujeme, či má obrázok

            if (!existingProductIds.has(productId)) {
                console.log(`🆕 Adding new product: ${name} (${productId})`);
                newProducts.push({ id: productId, name, image_url: imageUrl });
            } else {
                console.log(`⚠️ Product already exists, skipping: ${name} (${productId})`);
            }

            // 🛠 Spracovanie veľkostí
            if (item.VARIANTS && item.VARIANTS[0].VARIANT) {
                for (const variant of item.VARIANTS[0].VARIANT) {
                    const size = variant.PARAMETERS?.[0]?.PARAMETER?.[0]?.VALUE?.[0] || "Unknown";
                    const price = parseFloat(variant.PRICE_VAT?.[0]) || null;
                    const originalPrice = price; // Pôvodná cena je rovnaká ako price pri vkladaní
                    const status = variant.AVAILABILITY_OUT_OF_STOCK?.[0] || "Unknown";

                    console.log(`🆕 Adding size: ${size} for product ${productId} → Price: ${price}, Status: ${status}`);

                    newSizes.push({ 
                        product_id: productId, 
                        size, 
                        price: price, 
                        original_price: originalPrice, 
                        status: status  
                    });
                }
            }
        }

        // 🛠 Použijeme UPSERT na vloženie len nových produktov (s obrázkom)
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

        // 🛠 Vložíme veľkosti do `product_sizes`
        if (newSizes.length > 0) {
            console.log(`🚀 Inserting ${newSizes.length} sizes...`);
            const { error: insertSizeError } = await supabase
                .from('product_sizes')
                .upsert(newSizes, { onConflict: ['product_id', 'size'] });

            if (insertSizeError) console.error("❌ Error inserting sizes:", insertSizeError);
            else console.log(`✅ Inserted ${newSizes.length} sizes.`);
        } else {
            console.log("✅ No new sizes to insert.");
        }

        console.log("✅ All updates finished.");

    } catch (error) {
        console.error("❌ Error processing XML:", error);
    }
}

fetchAndProcessXML();
