const token = localStorage.token;
if(!token) window.location.href = "../login.html";

document.addEventListener("DOMContentLoaded", () => {

    const connectBtn = document.getElementById("connectAccountBtn");
    const modal       = document.getElementById("accountModal");
    const closeBtn    = document.getElementById("closeAccountModal");

    if(!connectBtn || !modal){
        console.error("Accounts page elements missing — check HTML IDs");
        return;
    }

    function openModal(){
        modal.classList.add("open");
    }
    function closeModal(){
        modal.classList.remove("open");
    }

    connectBtn.addEventListener("click", openModal);
    closeBtn?.addEventListener("click", closeModal);

    modal.addEventListener("click", (e) => {
        if(e.target === modal){
            closeModal();
        }
    });

    document.addEventListener("keydown", (e) => {
        if(e.key === "Escape" && modal.classList.contains("open")){
            closeModal();
        }
    });

    function formatDate(dateString){
        const date = new Date(dateString);
        return date.toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric"
        });
    }

    async function loadAccounts(){
        const accounts = await getAccounts(token);
        const table    = document.getElementById("accountsTable");

        table.innerHTML = "";

        if(!Array.isArray(accounts) || accounts.length === 0){
            table.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align: center; color: var(--muted); padding: 60px 20px;">
                        <i class="fas fa-briefcase" style="font-size: 2rem; margin-bottom: 16px; display: block; opacity: 0.3;"></i>
                        <p style="margin-bottom: 8px;">No accounts connected yet.</p>
                        <p style="font-size: 13px;">Click <strong style="color: white;">+ Connect Account</strong> to get started.</p>
                    </td>
                </tr>
            `;
            return;
        }

        accounts.forEach(account => {

            const row = document.createElement("tr");

            row.innerHTML = `
                <td>${account.account_number}</td>
                <td>${account.broker}</td>
                <td><span class="status-badge">${account.status}</span></td>
                <td>${formatDate(account.created_at)}</td>
                <td>
                    <button class="delete-btn" data-id="${account.id}">Delete</button>
                </td>
            `;

            row.querySelector(".delete-btn")
                .addEventListener("click", async () => {
                    if(!confirm("Delete this account?")) return;
                    await deleteAccount(account.id, token);
                    await loadAccounts();
                });
        });
    }

    document.getElementById("accountForm")
        .addEventListener("submit", async (e) => {
            e.preventDefault();

            const accountName = document.getElementById("accountName").value.trim();
            const broker       = document.getElementById("broker").value.trim();

            const result = await createAccount({
                account_name: accountName,
                broker:       broker,
                server:       "",
                account_number: accountName,
                investor_password: ""
            }, token);

            if(result.message === "Account created"){
                closeModal();
                document.getElementById("accountForm").reset();
                await loadAccounts();
            } else {
                alert(result.detail || "Failed to create account. Try again.");
            }
        });

    loadAccounts();

});

//Logout
document.getElementById("logoutBtn").addEventListener("click", () => {
    localStorage.removeItem("token");
    window.location.href = "../login.html";
});
