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
        let priceUpdates = [];

        console.log("🛠 Processing products...");
        for (const item of items) {
            const productId = item.$.id;
            const name = item.NAME?.[0] || "Unknown";

            if (!item.VARIANTS || !item.VARIANTS[0].VARIANT) continue;

            if (!existingProductIds.has(productId)) {
                console.log(`🆕 Adding new product: ${name} (${productId})`);
                newProducts.push({ id: productId, name });
            }
        }

        // 🛠 Najprv pridáme iba nové produkty
        if (newProducts.length > 0) {
            console.log(`🚀 Inserting ${newProducts.length} new products...`);
            const { error: insertError } = await supabase.from('products').insert(newProducts);
            if (insertError) {
                console.error("❌ Error inserting products:", insertError);
                return;
            }
            console.log(`✅ Inserted ${newProducts.length} new products.`);
        }

        // 📡 Aktualizujeme zoznam produktov, aby veľkosti odkazovali na správne ID
        console.log("📡 Fetching updated product list from Supabase...");
        const { data: updatedProducts, error: updateFetchError } = await supabase
            .from('products')
            .select('id');

        if (updateFetchError) {
            console.error("❌ Error fetching updated product list:", updateFetchError);
            return;
        }

        existingProductIds = new Set(updatedProducts.map(p => p.id));

        console.log("📡 Fetching existing sizes from Supabase...");
        const { data: existingSizes, error: fetchSizesError } = await supabase
            .from('product_sizes')
            .select('product_id, size, price');

        if (fetchSizesError) {
            console.error("❌ Error fetching existing sizes:", fetchSizesError);
            return;
        }

        const existingSizeMap = new Map(
            existingSizes.map(s => [`${s.product_id}-${s.size}`, s.price])
        );

        // 🛠 Spracovanie veľkostí až po úspešnom vložení produktov
        for (const item of items) {
            const productId = item.$.id;

            if (!existingProductIds.has(productId)) {
                console.error(`❌ Product ID ${productId} not found in database! Skipping sizes.`);
                continue;
            }

            for (const variant of item.VARIANTS[0].VARIANT) {
                const size = variant.PARAMETERS?.[0]?.PARAMETER?.[0]?.VALUE?.[0] || "Unknown";
                const priceVat = parseFloat(variant.PRICE_VAT?.[0]) || null;
                const status = variant.AVAILABILITY_OUT_OF_STOCK?.[0] || "Unknown";

                const key = `${productId}-${size}`;

                if (!existingSizeMap.has(key)) {
                    console.log(`🆕 Adding new size: ${size} for product ${productId}`);
                    newSizes.push({ 
                        product_id: productId, 
                        size, 
                        price: priceVat, 
                        status: status,  
                        original_price: priceVat  
                    });
                } else {
                    const existingPrice = existingSizeMap.get(key);
                    if (existingPrice !== priceVat) {
                        console.log(`🔄 Updating price for ${productId} - ${size}: ${existingPrice} → ${priceVat}`);
                        priceUpdates.push({ product_id: productId, size, price: priceVat });
                    }
                }
            }
        }

        if (newSizes.length > 0) {
            console.log(`🚀 Inserting ${newSizes.length} new sizes...`);
            const { error: insertSizeError } = await supabase.from('product_sizes').insert(newSizes);
            if (insertSizeError) console.error("❌ Error inserting sizes:", insertSizeError);
            else console.log(`✅ Inserted ${newSizes.length} new sizes.`);
        }

        for (const update of priceUpdates) {
            const { error: updateError } = await supabase
                .from('product_sizes')
                .update({ price: update.price })
                .eq('product_id', update.product_id)
                .eq('size', update.size);

            if (updateError) console.error("❌ Error updating price:", updateError);
        }

        console.log("✅ All updates finished.");

    } catch (error) {
        console.error("❌ Error processing XML:", error);
    }
}

fetchAndProcessXML();
