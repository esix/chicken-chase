import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import java.io.FileWriter;
import java.io.PrintWriter;

public class DecompileAll extends GhidraScript {
    @Override
    public void run() throws Exception {
        DecompInterface decomp = new DecompInterface();
        decomp.openProgram(currentProgram);

        String outputPath = getScriptArgs()[0];
        PrintWriter pw = new PrintWriter(new FileWriter(outputPath));

        FunctionIterator funcs = currentProgram.getFunctionManager().getFunctions(true);
        int count = 0;
        while (funcs.hasNext()) {
            Function func = funcs.next();
            if (monitor.isCancelled()) break;

            DecompileResults results = decomp.decompileFunction(func, 60, monitor);
            String decompiledC = results.getDecompiledFunction() != null ?
                results.getDecompiledFunction().getC() : "// Failed to decompile";

            pw.println("//========================================");
            pw.println("// Function: " + func.getName());
            pw.println("// Address: " + func.getEntryPoint());
            pw.println("// Signature: " + func.getSignature());
            pw.println("//========================================");
            pw.println(decompiledC);
            pw.println();
            count++;
        }

        pw.close();
        decomp.dispose();
        println("Decompiled " + count + " functions to " + outputPath);
    }
}
