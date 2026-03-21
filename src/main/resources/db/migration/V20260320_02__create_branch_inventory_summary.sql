CREATE TABLE IF NOT EXISTS branch_inventory_summary (
    branch VARCHAR(255) NOT NULL,
    branch_name VARCHAR(255) NOT NULL,
    stock_count INT NOT NULL DEFAULT 0,
    priced_count INT NOT NULL DEFAULT 0,
    total_amount BIGINT NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (branch),
    KEY idx_branch_inventory_summary_total_amount (total_amount),
    KEY idx_branch_inventory_summary_updated_at (updated_at)
);
