package com.example.bookshelf;

import com.example.bookshelf.user.repository.BranchInventoryRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.stereotype.Component;

@Component
public class BranchInventorySummaryInitializer implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(BranchInventorySummaryInitializer.class);
    private final BranchInventoryRepository branchInventoryRepository;

    public BranchInventorySummaryInitializer(BranchInventoryRepository branchInventoryRepository) {
        this.branchInventoryRepository = branchInventoryRepository;
    }

    @Override
    public void run(String... args) {
        try {
            int summaryCount = branchInventoryRepository.countBranchInventorySummaries();
            if (summaryCount == 0) {
                log.info("branch_inventory_summary is empty. rebuilding once on startup.");
                branchInventoryRepository.rebuildBranchInventorySummary();
            }
        } catch (BadSqlGrammarException e) {
            log.warn("branch_inventory_summary table is not ready yet. skip startup rebuild.");
        } catch (Exception e) {
            log.warn("Failed to initialize branch_inventory_summary on startup", e);
        }
    }
}
