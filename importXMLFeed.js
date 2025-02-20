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

        console.log(`📊 Total products in XML: ${items.length}`);

        console.log("📡 Fetching existing products from Supabase...");
        const { data: existingProducts, error: fetchError } = await supabase
            .from('products')
            .select('id');

        if (fetchError) {
            console.error("❌ Error fetching existing products:", fetchError);
            return;
        }

        const existingProductIds = new Set(existingProducts.map(p => p.id));

        let newProducts = [];
        let newSizes = [];
        let updates = [];

        console.log("🛠 Processing products...");
        for (const item of items) {
            const productId = item.$.id;
            const name = item.NAME?.[0] || "Unknown";

            if (!item.VARIANTS || !item.VARIANTS[0].VARIANT) continue;

            let productExists = existingProductIds.has(productId);
            if (!productExists) {
                console.log(`🆕 Adding new product: ${name} (${productId})`);
                newProducts.push({ id: productId, name });
            }
        }

        // 🛠 Najprv pridáme produkty
        if (newProducts.length > 0) {
            console.log(`🚀 Inserting ${newProducts.length} new products...`);
            const { error: insertError } = await supabase.from('products').insert(newProducts);
            if (insertError) {
                console.error("❌ Error inserting products:", insertError);
                return; // Ak sa produkty nevložia, zastavíme skript
            }
            console.log(`✅ Inserted ${newProducts.length} new products.`);
        }

        console.log("📡 Fetching updated product list from Supabase...");
        const { data: updatedProducts, error: updateFetchError } = await supabase
            .from('products')
            .select('id');

        if (updateFetchError) {
            console.error("❌ Error fetching updated product list:", updateFetchError);
            return;
        }

        const updatedProductIds = new Set(updatedProducts.map(p => p.id));

        // Spracovanie veľkostí až po úspešnom vložení produktov
        for (const item of items) {
            const productId = item.$.id;

            if (!updatedProductIds.has(productId)) {
                console.error(`❌ Product ID ${productId} not found in database! Skipping sizes.`);
                continue;
            }

            for (const variant of item.VARIANTS[0].VARIANT) {
                const size = variant.PARAMETERS?.[0]?.PARAMETER?.[0]?.VALUE?.[0] || "Unknown";
                const priceVat = parseFloat(variant.PRICE_VAT?.[0]) || null;
                const status = variant.AVAILABILITY_OUT_OF_STOCK?.[0] || "Unknown";

                const { data: existingSize, error: sizeError } = await supabase
                    .from('product_sizes')
                    .select('product_id, size, price, status, original_price')
                    .eq('product_id', productId)
                    .eq('size', size)
                    .single();

                if (sizeError && sizeError.code !== 'PGRST116') {
                    console.error("❌ Database error:", sizeError);
                    continue;
                }

                if (!existingSize) {
                    console.log(`🆕 Adding new size: ${size} for product ${productId}`);
                    newSizes.push({ 
                        product_id: productId, 
                        size, 
                        price: priceVat, 
                        status: status,  
                        original_price: priceVat  
                    });
                } else {
                    let updateData = {};
                    if (existingSize.price !== priceVat) {
                        console.log(`🔄 Updating price for ${productId} - ${size}: ${existingSize.price} → ${priceVat}`);
                        updateData.price = priceVat;
                    }
                    if (existingSize.status !== status) {  
                        console.log(`🔄 Updating status for ${productId} - ${size}: ${existingSize.status} → ${status}`);
                        updateData.status = status;
                    }
                    if (Object.keys(updateData).length > 0) {
                        updateData.product_id = existingSize.product_id;  
                        updateData.size = existingSize.size;
                        updates.push(updateData);
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

        for (const update of updates) {
            const { error: updateError } = await supabase
                .from('product_sizes')
                .update(update)
                .eq('product_id', update.product_id)
                .eq('size', update.size);

            if (updateError) console.error("❌ Error updating product size:", updateError);
        }

        console.log("✅ All updates finished.");

    } catch (error) {
        console.error("❌ Error processing XML:", error);
    }
}

fetchAndProcessXML();
