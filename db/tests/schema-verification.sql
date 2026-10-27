-- Run only against a disposable, fully migrated database. All fixtures and the
-- temporary helper roll back. No provider calls or real customer records occur.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL search_path = public, pg_catalog;
SET LOCAL TIME ZONE 'UTC';

CREATE FUNCTION pg_temp.expect_rejection(statement TEXT, expected_state TEXT, expected_constraint TEXT DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql AS $function$
DECLARE
    actual_constraint TEXT;
BEGIN
    BEGIN
        EXECUTE statement;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS actual_constraint = CONSTRAINT_NAME;
        IF SQLSTATE <> expected_state OR (expected_constraint IS NOT NULL AND actual_constraint <> expected_constraint) THEN
            RAISE EXCEPTION 'Expected SQLSTATE % / constraint %, received % / %: %',
                expected_state, expected_constraint, SQLSTATE, actual_constraint, SQLERRM;
        END IF;
        RETURN;
    END;
    RAISE EXCEPTION 'Statement unexpectedly succeeded: %', statement;
END;
$function$;

DO $test$
DECLARE
    repeat_product UUID;
    unique_product UUID;
    bespoke_product UUID;
    repeat_variant UUID;
    unique_variant UUID;
    bespoke_variant UUID;
    individual_stone UUID;
    group_stones UUID;
    customer UUID;
    cart UUID;
    other_cart UUID;
    purchase UUID;
    delivery_order UUID;
    collection_order UUID;
    address UUID;
    location UUID;
    staff UUID;
    attempt UUID;
    arrangement UUID;
    replacement UUID;
    reservation UUID;
    category UUID;
    affected INTEGER;
BEGIN
    IF (SELECT count(*) FROM schema_migrations) <> 5 THEN RAISE EXCEPTION 'Expected five applied migrations'; END IF;
    IF (SELECT count(*) FROM pg_tables WHERE schemaname = 'public') <> 31 THEN RAISE EXCEPTION 'Expected 30 business tables and ledger'; END IF;
    IF EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.connamespace = 'public'::regnamespace AND c.contype = 'f' AND c.confdeltype = 'c'
          AND c.conrelid NOT IN ('product_categories'::regclass, 'product_collections'::regclass,
                                'customer_addresses'::regclass, 'cart_items'::regclass)
    ) THEN RAISE EXCEPTION 'Unexpected cascading delete outside disposable relations'; END IF;
    IF EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.connamespace = 'public'::regnamespace AND c.contype = 'f'
          AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid
              AND i.indisvalid AND i.indpred IS NULL AND i.indkey[0] = c.conkey[1])
    ) THEN RAISE EXCEPTION 'Foreign key has no unconditional index beginning with its first column'; END IF;
    IF EXISTS (
        SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.connamespace = 'public'::regnamespace AND c.contype = 'p'
          AND (cardinality(c.conkey) <> 1 OR a.atttypid <> 'uuid'::regtype)
    ) THEN RAISE EXCEPTION 'Primary keys must be UUIDs'; END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
          AND ((column_name LIKE '%\_minor' ESCAPE '\' AND data_type <> 'bigint')
            OR (column_name LIKE '%\_at' ESCAPE '\' AND data_type <> 'timestamp with time zone')
            OR (column_name LIKE '%carat_weight' AND data_type <> 'numeric'))
    ) THEN RAISE EXCEPTION 'Money, weight, or timestamp type regression'; END IF;

    INSERT INTO products(slug, name, product_type, sales_mode)
        VALUES ('schema-test-repeatable', 'Schema fixture A', 'REPEATABLE', 'BOTH') RETURNING id INTO repeat_product;
    INSERT INTO products(slug, name, product_type, sales_mode)
        VALUES ('schema-test-unique', 'Schema fixture B', 'ONE_OF_A_KIND', 'DIRECT_PURCHASE') RETURNING id INTO unique_product;
    INSERT INTO products(slug, name, product_type)
        VALUES ('schema-test-bespoke', 'Schema fixture C', 'BESPOKE') RETURNING id INTO bespoke_product;
    PERFORM pg_temp.expect_rejection(format('UPDATE products SET sales_mode = ''BOTH'' WHERE id = %L', bespoke_product), '23514', 'products_bespoke_enquiry_only');
    PERFORM pg_temp.expect_rejection(format('UPDATE products SET status = ''PUBLISHED'' WHERE id = %L', repeat_product), '23514', 'products_publication_date');
    INSERT INTO product_variants(product_id, product_type, sku, is_active)
        VALUES (repeat_product, 'REPEATABLE', 'SCHEMA-TEST-A', true) RETURNING id INTO repeat_variant;
    INSERT INTO product_variants(product_id, product_type, sku)
        VALUES (unique_product, 'ONE_OF_A_KIND', 'SCHEMA-TEST-B') RETURNING id INTO unique_variant;
    INSERT INTO product_variants(product_id, product_type, sku)
        VALUES (bespoke_product, 'BESPOKE', 'SCHEMA-TEST-C') RETURNING id INTO bespoke_variant;
    PERFORM pg_temp.expect_rejection(format('INSERT INTO product_variants(product_id, product_type, sku) VALUES (%L, ''ONE_OF_A_KIND'', ''SCHEMA-TEST-B2'')', unique_product), '23505', 'product_variants_one_of_a_kind_idx');
    PERFORM pg_temp.expect_rejection(format('UPDATE product_variants SET product_type = ''REPEATABLE'' WHERE id = %L', bespoke_variant), '23503', 'product_variants_product_type_fk');

    INSERT INTO product_prices(variant_id, amount_minor) VALUES (repeat_variant, 10000);
    INSERT INTO product_prices(variant_id, amount_minor, is_active) VALUES (repeat_variant, 9000, false);
    INSERT INTO product_prices(variant_id, currency, amount_minor) VALUES (repeat_variant, 'USD', 200);
    PERFORM pg_temp.expect_rejection(format('INSERT INTO product_prices(variant_id, amount_minor) VALUES (%L, 12000)', repeat_variant), '23505', 'product_prices_active_currency_idx');
    INSERT INTO product_media(product_id, external_media_reference, media_type, is_primary)
        VALUES (repeat_product, 'schema-fixture/image-a', 'IMAGE', true);
    PERFORM pg_temp.expect_rejection(format('INSERT INTO product_media(product_id, external_media_reference, media_type, is_primary) VALUES (%L, ''schema-fixture/image-b'', ''IMAGE'', true)', repeat_product), '23505', 'product_media_primary_idx');
    PERFORM pg_temp.expect_rejection(format('INSERT INTO product_media(product_id, external_media_reference, media_type, is_primary) VALUES (%L, ''schema-fixture/video'', ''VIDEO'', true)', repeat_product), '23514', 'product_media_primary_image');
    INSERT INTO categories(slug, name) VALUES ('schema-test-category', 'Schema category') RETURNING id INTO category;
    PERFORM pg_temp.expect_rejection(format('UPDATE categories SET parent_id = id WHERE id = %L', category), '23514', 'categories_not_own_parent');

    INSERT INTO gemstones(specification_kind, stone_type, shape, color, carat_weight)
        VALUES ('INDIVIDUAL', 'Fixture stone', 'Fixture shape', 'Fixture color', 1.2345) RETURNING id INTO individual_stone;
    INSERT INTO gemstones(specification_kind, stone_type, shape, color)
        VALUES ('GROUP', 'Fixture accents', 'Fixture shape', 'Fixture color') RETURNING id INTO group_stones;
    IF (SELECT report_verification_status <> 'UNVERIFIED' OR provenance_status <> 'UNKNOWN' OR carat_weight <> 1.2345
        FROM gemstones WHERE id = individual_stone) THEN RAISE EXCEPTION 'Stone defaults or exact decimal storage changed'; END IF;
    PERFORM pg_temp.expect_rejection(format('UPDATE gemstones SET carat_weight = ''NaN'' WHERE id = %L', individual_stone), '23514', 'gemstones_finite_weight');
    PERFORM pg_temp.expect_rejection(format('UPDATE gemstones SET report_verification_status = ''VERIFIED'' WHERE id = %L', individual_stone), '23514', 'gemstones_verified_report');
    PERFORM pg_temp.expect_rejection(format('INSERT INTO product_gemstones(variant_id, gemstone_id, specification_kind, quantity, gemstone_role) VALUES (%L, %L, ''INDIVIDUAL'', 2, ''CENTER'')', unique_variant, individual_stone), '23514', 'product_gemstones_individual_quantity');
    INSERT INTO product_gemstones(variant_id, gemstone_id, specification_kind, quantity, gemstone_role)
        VALUES (unique_variant, individual_stone, 'INDIVIDUAL', 1, 'CENTER'),
               (unique_variant, group_stones, 'GROUP', 12, 'ACCENT'),
               (repeat_variant, group_stones, 'GROUP', 8, 'ACCENT');
    PERFORM pg_temp.expect_rejection(format('INSERT INTO product_gemstones(variant_id, gemstone_id, specification_kind, quantity, gemstone_role) VALUES (%L, %L, ''INDIVIDUAL'', 1, ''CENTER'')', repeat_variant, individual_stone), '23505', 'product_gemstones_individual_idx');

    INSERT INTO inventory(variant_id, product_type, on_hand) VALUES
        (repeat_variant, 'REPEATABLE', 3), (unique_variant, 'ONE_OF_A_KIND', 1), (bespoke_variant, 'BESPOKE', 0);
    PERFORM pg_temp.expect_rejection(format('UPDATE inventory SET on_hand = 2 WHERE variant_id = %L', unique_variant), '23514', 'inventory_unique_unit');
    PERFORM pg_temp.expect_rejection(format('UPDATE inventory SET reserved = 2 WHERE variant_id = %L', unique_variant), '23514', 'inventory_reserved_limit');
    PERFORM pg_temp.expect_rejection(format('UPDATE inventory SET on_hand = -1 WHERE variant_id = %L', repeat_variant), '23514');
    PERFORM pg_temp.expect_rejection(format('UPDATE inventory SET on_hand = 1 WHERE variant_id = %L', bespoke_variant), '23514', 'inventory_bespoke_no_stock');
    PERFORM pg_temp.expect_rejection(format('UPDATE inventory SET product_type = ''REPEATABLE'' WHERE variant_id = %L', unique_variant), '23503', 'inventory_variant_type_fk');

    INSERT INTO customer_profiles(full_name, email) VALUES ('Schema customer', 'schema@example.invalid') RETURNING id INTO customer;
    INSERT INTO customer_addresses(customer_profile_id, recipient_name, recipient_phone, governorate, city_area, street_address)
        VALUES (customer, 'Schema recipient', 'test-only', 'Fixture governorate', 'Fixture area', 'Fixture street');
    INSERT INTO carts(session_token_hash, expires_at) VALUES (repeat('a', 64), now() + interval '1 hour') RETURNING id INTO cart;
    INSERT INTO carts(session_token_hash, expires_at) VALUES (repeat('b', 64), now() + interval '1 hour') RETURNING id INTO other_cart;
    INSERT INTO cart_items(cart_id, variant_id, quantity) VALUES (cart, unique_variant, 1);
    IF (SELECT reserved <> 0 FROM inventory WHERE variant_id = unique_variant) OR EXISTS (SELECT 1 FROM inventory_reservations)
        THEN RAISE EXCEPTION 'Adding a cart item reserved stock'; END IF;
    PERFORM pg_temp.expect_rejection(format('INSERT INTO cart_items(cart_id, variant_id, quantity) VALUES (%L, %L, 1)', cart, unique_variant), '23505', 'cart_items_selection_key');

    INSERT INTO orders(order_number, source_cart_id, customer_profile_id, customer_name, customer_phone, subtotal_minor, total_minor, fulfillment_method)
        VALUES ('SCHEMA-TEST-ORDER', cart, customer, 'Snapshot name', 'test-only', 10000, 10000, 'BOUTIQUE_COLLECTION') RETURNING id INTO purchase;
    INSERT INTO order_items(order_id, product_id, variant_id, sku_snapshot, product_name_snapshot, quantity, unit_price_minor)
        VALUES (purchase, repeat_product, repeat_variant, 'SCHEMA-TEST-A', 'Original snapshot', 1, 10000);
    UPDATE products SET name = 'Updated live name' WHERE id = repeat_product;
    UPDATE product_prices SET amount_minor = 11000 WHERE variant_id = repeat_variant AND is_active AND currency = 'EGP';
    IF NOT EXISTS (SELECT 1 FROM order_items WHERE order_id = purchase AND product_name_snapshot = 'Original snapshot'
        AND unit_price_minor = 10000 AND line_subtotal_minor = 10000 AND line_total_minor = 10000)
        THEN RAISE EXCEPTION 'Historical item snapshots changed'; END IF;
    PERFORM pg_temp.expect_rejection(format('UPDATE orders SET total_minor = 9999 WHERE id = %L', purchase), '23514', 'orders_total_equation');
    PERFORM pg_temp.expect_rejection(format('UPDATE order_items SET product_id = %L WHERE order_id = %L', unique_product, purchase), '23503', 'order_items_variant_product_fk');
    PERFORM pg_temp.expect_rejection(format('UPDATE order_items SET product_id = NULL WHERE order_id = %L', purchase), '23514', 'order_items_variant_requires_product');

    INSERT INTO payments(order_id, amount_minor, provider_order_reference, provider_intention_reference, provider_transaction_reference, status)
        VALUES (purchase, 10000, 'schema-provider-order', 'schema-provider-intention', 'schema-failed-transaction', 'FAILED');
    INSERT INTO payments(order_id, amount_minor, provider_order_reference, provider_intention_reference, provider_transaction_reference, status, succeeded_at)
        VALUES (purchase, 10000, 'schema-provider-order', 'schema-provider-intention', 'schema-success-transaction', 'SUCCEEDED', now()) RETURNING id INTO attempt;
    PERFORM pg_temp.expect_rejection(format('INSERT INTO payments(order_id, amount_minor, currency) VALUES (%L, 10000, ''USD'')', purchase), '23503', 'payments_order_currency_fk');
    PERFORM pg_temp.expect_rejection(format('INSERT INTO payments(order_id, amount_minor, provider_transaction_reference) VALUES (%L, 10000, ''schema-success-transaction'')', purchase), '23505', 'payments_transaction_key');
    PERFORM pg_temp.expect_rejection(format('UPDATE payments SET refunded_minor = 10001 WHERE id = %L', attempt), '23514', 'payments_refund_limit');
    INSERT INTO payment_events(payment_id, deduplication_key) VALUES (attempt, 'schema-event-key');
    PERFORM pg_temp.expect_rejection('INSERT INTO payment_events(deduplication_key) VALUES (''schema-event-key'')', '23505', 'payment_events_deduplication_key');
    PERFORM pg_temp.expect_rejection('UPDATE payment_events SET status = ''PROCESSED'', processed_at = now() WHERE deduplication_key = ''schema-event-key''', '23514', 'payment_events_verified_processing');
    UPDATE payment_events SET signature_verified = true, status = 'PROCESSED', processed_at = now() WHERE deduplication_key = 'schema-event-key';
    IF (SELECT fulfillment_status <> 'UNARRANGED' FROM orders WHERE id = purchase) THEN RAISE EXCEPTION 'Payment changed fulfillment state'; END IF;

    PERFORM pg_temp.expect_rejection(format('INSERT INTO inventory_reservations(variant_id, quantity, expires_at) VALUES (%L, 1, now() + interval ''1 hour'')', unique_variant), '23514', 'inventory_reservations_owner');
    PERFORM pg_temp.expect_rejection(format('INSERT INTO inventory_reservations(variant_id, quantity, order_id, cart_id, expires_at) VALUES (%L, 1, %L, %L, now() + interval ''1 hour'')', unique_variant, purchase, other_cart), '23503', 'inventory_reservations_order_cart_fk');
    UPDATE inventory SET reserved = reserved + 1 WHERE variant_id = unique_variant AND on_hand - reserved >= 1;
    INSERT INTO inventory_reservations(variant_id, quantity, cart_id, order_id, expires_at)
        VALUES (unique_variant, 1, cart, purchase, now() + interval '1 hour') RETURNING id INTO reservation;
    UPDATE inventory SET reserved = reserved + 1 WHERE variant_id = unique_variant AND on_hand - reserved >= 1;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN RAISE EXCEPTION 'Guarded update reserved unavailable stock'; END IF;
    PERFORM pg_temp.expect_rejection(format('INSERT INTO inventory_reservations(variant_id, quantity, order_id, expires_at) VALUES (%L, 1, %L, now() + interval ''1 hour'')', unique_variant, purchase), '23505', 'inventory_reservations_active_order_idx');
    PERFORM pg_temp.expect_rejection(format('UPDATE inventory_reservations SET status = ''CONSUMED'' WHERE id = %L', reservation), '23514', 'inventory_reservations_end_state');
    UPDATE inventory_reservations SET status = 'CONSUMED', ended_at = now() WHERE id = reservation;
    UPDATE inventory SET on_hand = on_hand - 1, reserved = reserved - 1 WHERE variant_id = unique_variant;
    IF (SELECT on_hand <> 0 OR reserved <> 0 FROM inventory WHERE variant_id = unique_variant) THEN RAISE EXCEPTION 'Consumption arithmetic failed'; END IF;

    INSERT INTO admin_users(display_name, role, auth_provider, auth_subject, is_active)
        VALUES ('Schema staff', 'STAFF', 'schema-test', 'schema-subject', true) RETURNING id INTO staff;
    INSERT INTO boutique_locations(name, governorate, city_area, street_address, is_active)
        VALUES ('Schema location', 'Fixture governorate', 'Fixture area', 'Fixture street', true) RETURNING id INTO location;
    INSERT INTO orders(order_number, customer_name, customer_phone, subtotal_minor, total_minor, fulfillment_method)
        VALUES ('SCHEMA-TEST-COLLECTION', 'Snapshot name', 'test-only', 0, 0, 'BOUTIQUE_COLLECTION') RETURNING id INTO collection_order;
    PERFORM pg_temp.expect_rejection(format('INSERT INTO fulfillment_arrangements(order_id, method, status, scheduled_start_at, scheduled_end_at) VALUES (%L, ''BOUTIQUE_COLLECTION'', ''CONFIRMED'', now(), now() + interval ''1 hour'')', collection_order), '23514', 'fulfillment_arrangements_destination');
    INSERT INTO fulfillment_arrangements(order_id, method) VALUES (collection_order, 'BOUTIQUE_COLLECTION') RETURNING id INTO arrangement;
    PERFORM pg_temp.expect_rejection(format('INSERT INTO fulfillment_arrangements(order_id, method) VALUES (%L, ''BOUTIQUE_COLLECTION'')', collection_order), '23505', 'fulfillment_arrangements_current_idx');
    UPDATE fulfillment_arrangements SET status = 'CONFIRMED', boutique_location_id = location,
        scheduled_start_at = now(), scheduled_end_at = now() + interval '1 hour' WHERE id = arrangement;
    UPDATE fulfillment_arrangements SET status = 'RESCHEDULED' WHERE id = arrangement;
    INSERT INTO fulfillment_arrangements(order_id, method, supersedes_id, boutique_location_id, status, scheduled_start_at, scheduled_end_at)
        VALUES (collection_order, 'BOUTIQUE_COLLECTION', arrangement, location, 'CONFIRMED', now() + interval '1 day', now() + interval '25 hours') RETURNING id INTO replacement;
    PERFORM pg_temp.expect_rejection(format('UPDATE fulfillment_arrangements SET status = ''COMPLETED'', completed_at = now() WHERE id = %L', replacement), '23514', 'fulfillment_arrangements_completion');
    UPDATE fulfillment_arrangements SET status = 'COMPLETED', completed_at = now(), completed_by_admin_id = staff WHERE id = replacement;
    PERFORM pg_temp.expect_rejection(format('INSERT INTO fulfillment_events(arrangement_id, event_type, actor_kind) VALUES (%L, ''HANDOVER_COMPLETED'', ''SYSTEM'')', replacement), '23514', 'fulfillment_events_handover');
    INSERT INTO fulfillment_events(arrangement_id, event_type, actor_kind, actor_admin_id, handover_recipient_name)
        VALUES (replacement, 'HANDOVER_COMPLETED', 'ADMIN', staff, 'Schema recipient');

    INSERT INTO orders(order_number, customer_name, customer_phone, subtotal_minor, total_minor, fulfillment_method)
        VALUES ('SCHEMA-TEST-DELIVERY', 'Snapshot name', 'test-only', 0, 0, 'PRIVATE_DELIVERY') RETURNING id INTO delivery_order;
    INSERT INTO order_addresses(order_id, recipient_name, recipient_phone, governorate, city_area, street_address)
        VALUES (delivery_order, 'Snapshot recipient', 'test-only', 'Fixture governorate', 'Fixture area', 'Snapshot street') RETURNING id INTO address;
    PERFORM pg_temp.expect_rejection(format('INSERT INTO fulfillment_arrangements(order_id, method, delivery_address_id) VALUES (%L, ''PRIVATE_DELIVERY'', %L)', purchase, address), '23503');
    INSERT INTO order_addresses(order_id, recipient_name, recipient_phone, governorate, city_area, street_address)
        VALUES (purchase, 'Other snapshot', 'test-only', 'Fixture governorate', 'Fixture area', 'Other street');
    PERFORM pg_temp.expect_rejection(format('INSERT INTO fulfillment_arrangements(order_id, method, delivery_address_id) VALUES (%L, ''PRIVATE_DELIVERY'', %L)', delivery_order, (SELECT id FROM order_addresses WHERE order_id = purchase)), '23503', 'fulfillment_arrangements_address_fk');
    INSERT INTO fulfillment_arrangements(order_id, method, delivery_address_id) VALUES (delivery_order, 'PRIVATE_DELIVERY', address);
    PERFORM pg_temp.expect_rejection(format('DELETE FROM order_addresses WHERE id = %L', address), '23503', 'fulfillment_arrangements_address_fk');

    INSERT INTO bespoke_requests(contact_name, contact_phone, message) VALUES ('Schema guest', 'test-only', 'Schema constraint fixture');
    INSERT INTO appointment_requests(contact_name, contact_email, message) VALUES ('Schema guest', 'schema@example.invalid', 'Schema constraint fixture');
    INSERT INTO product_enquiries(contact_name, contact_phone, message) VALUES ('Schema guest', 'test-only', 'Schema constraint fixture');
    PERFORM pg_temp.expect_rejection('INSERT INTO bespoke_requests(contact_name, message) VALUES (''Schema guest'', ''Schema constraint fixture'')', '23514', 'bespoke_requests_contact');
    PERFORM pg_temp.expect_rejection('UPDATE appointment_requests SET status = ''CONFIRMED''', '23514', 'appointment_requests_confirmation');
    INSERT INTO order_status_history(order_id, state_domain, to_status, actor_kind) VALUES (purchase, 'ORDER', 'PENDING_PAYMENT', 'SYSTEM');
    PERFORM pg_temp.expect_rejection(format('INSERT INTO order_status_history(order_id, state_domain, to_status, actor_kind) VALUES (%L, ''PAYMENT'', ''CONFIRMED'', ''SYSTEM'')', purchase), '23514', 'order_status_history_values');
    INSERT INTO audit_events(actor_kind, actor_admin_id, action, target_table, target_id)
        VALUES ('ADMIN', staff, 'schema.verify', 'orders', purchase);
    PERFORM pg_temp.expect_rejection('UPDATE audit_events SET metadata = ''[]''::jsonb', '23514', 'audit_events_bounded_metadata');
    PERFORM pg_temp.expect_rejection('UPDATE audit_events SET metadata = jsonb_build_object(''oversize'', repeat(''x'', 4096))', '23514', 'audit_events_bounded_metadata');
    PERFORM pg_temp.expect_rejection(format('DELETE FROM orders WHERE id = %L', purchase), '23503');
    PERFORM pg_temp.expect_rejection(format('DELETE FROM payments WHERE id = %L', attempt), '23503', 'payment_events_payment_id_fkey');
    PERFORM pg_temp.expect_rejection(format('DELETE FROM product_variants WHERE id = %L', repeat_variant), '23503');
    PERFORM pg_temp.expect_rejection(format('DELETE FROM admin_users WHERE id = %L', staff), '23503');
    DELETE FROM customer_profiles WHERE id = customer;
    IF (SELECT customer_profile_id IS NOT NULL OR customer_name <> 'Snapshot name' FROM orders WHERE id = purchase)
        OR EXISTS (SELECT 1 FROM customer_addresses WHERE customer_profile_id = customer)
        OR NOT EXISTS (SELECT 1 FROM order_addresses WHERE id = address AND street_address = 'Snapshot street')
        THEN RAISE EXCEPTION 'Profile deletion damaged historical snapshots or retained saved addresses'; END IF;
    RAISE NOTICE 'Schema verification passed: structure, catalogue, money, stock, guests, history, payments, fulfillment, requests, and audit.';
END;
$test$;
ROLLBACK;
