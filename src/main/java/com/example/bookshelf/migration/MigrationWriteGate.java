package com.example.bookshelf.migration;

import org.springframework.stereotype.Component;

/** Quiesces all mutating HTTP requests before copying DB and cover files. */
@Component
public class MigrationWriteGate {
    private boolean frozen;
    private int writers;

    public synchronized boolean enterWrite() {
        if (frozen) return false;
        writers++;
        return true;
    }

    public synchronized void leaveWrite() { writers--; notifyAll(); }
    public synchronized void freeze() { frozen = true; }
    public synchronized void thaw() { frozen = false; notifyAll(); }
    public synchronized boolean frozen() { return frozen; }
    public synchronized boolean drained() { return writers == 0; }
}
