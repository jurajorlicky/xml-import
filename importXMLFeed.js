const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
const { parseStringPromise, Builder } = require('xml2js');
const fs = require('fs');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const xmlFilePath = './feed.xml';  
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

        console.log("📡 Fetching product data from Supabase...");
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
            const manufacturer = item.MANUFACTURER?.[0] || "Unknown";

            if (!item.VARIANTS || !item.VARIANTS[0].VARIANT) continue;

            let productExists = existingProductIds.has(productId);
            if (!productExists) {
                console.log(`🆕 Adding new product: ${name} (${productId})`);
                newProducts.push({ id: productId, name, manufacturer });
            }

            for (const variant of item.VARIANTS[0].VARIANT) {
                const size = variant.PARAMETERS?.[0]?.PARAMETER?.[0]?.VALUE?.[0] || "Unknown";
                const priceVat = parseFloat(variant.PRICE_VAT?.[0]) || null;
                const stockStatus = variant.AVAILABILITY_OUT_OF_STOCK?.[0] || "Unknown";

                // Načítanie `product_sizes`, aby sme vedeli aktualizovať status
                const { data: existingSize, error: sizeError } = await supabase
                    .from('product_sizes')
                    .select('id, price, stock_status, original_price')
                    .eq('product_id', productId)
                    .eq('size', size)
                    .single();

                if (sizeError && sizeError.code !== 'PGRST116') {
                    console.error("❌ Database error:", sizeError);
                    continue;
                }

                // Ak varianta ešte neexistuje, pridáme ju a original_price uložíme do `product_sizes`
                if (!existingSize) {
                    console.log(`🆕 Adding new size: ${size} for product ${productId}`);
                    newSizes.push({ 
                        product_id: productId, 
                        size, 
                        price: priceVat, 
                        stock_status: stockStatus, 
                        original_price: priceVat  // Originálna cena sa ukladá sem!
                    });
                } else {
                    // Ak varianta existuje, porovnáme a aktualizujeme len ak sa zmenili hodnoty
                    let updateData = {};
                    if (existingSize.price !== priceVat) {
                        console.log(`🔄 Updating price for ${productId} - ${size}: ${existingSize.price} → ${priceVat}`);
                        updateData.price = priceVat;
                    }
                    if (existingSize.stock_status !== stockStatus) {
                        console.log(`🔄 Updating stock status for ${productId} - ${size}: ${existingSize.stock_status} → ${stockStatus}`);
                        updateData.stock_status = stockStatus;
                    }
                    if (Object.keys(updateData).length > 0) {
                        updateData.id = existingSize.id;
                        updates.push(updateData);
                    }
                }
            }
        }

        // Hromadné pridanie nových produktov
        if (newProducts.length > 0) {
            const { error: insertError } = await supabase.from('products').insert(newProducts);
            if (insertError) console.error("❌ Error inserting products:", insertError);
            else console.log(`✅ Inserted ${newProducts.length} new products.`);
        }

        // Hromadné pridanie nových veľkostí
        if (newSizes.length > 0) {
            const { error: insertSizeError } = await supabase.from('product_sizes').insert(newSizes);
            if (insertSizeError) console.error("❌ Error inserting sizes:", insertSizeError);
            else console.log(`✅ Inserted ${newSizes.length} new sizes.`);
        }

        // Hromadná aktualizácia existujúcich veľkostí
        for (const update of updates) {
            const { error: updateError } = await supabase
                .from('product_sizes')
                .update(update)
                .eq('id', update.id);

            if (updateError) console.error("❌ Error updating product size:", updateError);
        }

        console.log("✅ All updates finished.");

    } catch (error) {
        console.error("❌ Error processing XML:", error);
    }
}

// 🚀 Spustenie skriptu
fetchAndProcessXML();
